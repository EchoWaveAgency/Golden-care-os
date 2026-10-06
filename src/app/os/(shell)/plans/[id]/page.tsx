import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { ACCEPT_METHOD, ITEM_STATUS, LAB_STATUS, PLAN_STATUS, label } from "@/lib/dental";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { PrintButton } from "@/components/PrintButton";
import { acceptPlan, billPlan, cancelItem, cancelPlan, completeItem, createLabCase, proposePlan, recordDeposit, revisePlan, savePlan } from "@/app/actions/dental";
import { PlanEditor } from "./PlanEditor";
import { InstallmentPlanner } from "./InstallmentPlanner";

export const dynamic = "force-dynamic";

type Plan = { id: string; ref: string; branch_id: string; patient_id: string; doctor_id: string; title: string; notes: string | null; status: string; quote_no: string | null;
  proposed_at: string | null; valid_until: string | null; subtotal: number; discount_total: number; total: number; accepted_at: string | null; acceptance_method: string | null;
  acceptance_note: string | null; cancel_reason: string | null; created_at: string };
type Item = { id: string; seq: number; service_id: string; tooth: string | null; surfaces: string | null; quantity: number; unit_price: number; discount: number; line_total: number;
  lab_required: boolean; notes: string | null; status: string; done_at: string | null; invoice_id: string | null; cancel_reason: string | null;
  service: { code: string; name_ar: string; name_en: string } | null };
type Inst = { id: string; seq: number; due_on: string; amount: number; paid_amount: number };

export default async function PlanPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("plan.write", "plan.accept", "billing.read", "clinical.read", "lab.read");
  const ar = ctx.locale === "ar";
  const { data: p } = await ctx.supabase.from("treatment_plans").select("*").eq("id", params.id).maybeSingle<Plan>();
  if (!p) notFound();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const [{ data: items }, { data: inst }, { data: dir }, { data: doc }, { data: deps }, { data: adv }, { data: cases }, { data: labs }, { data: methods }, { data: dental }] = await Promise.all([
    ctx.supabase.from("treatment_plan_items").select("*, service:services(code, name_ar, name_en)").eq("plan_id", p.id).order("seq").returns<Item[]>(),
    ctx.supabase.from("plan_installments").select("id, seq, due_on, amount, paid_amount").eq("plan_id", p.id).order("seq").returns<Inst[]>(),
    ctx.supabase.rpc("patient_directory", { p_ids: [p.patient_id] }),
    ctx.supabase.from("staff").select("full_name_ar, full_name_en").eq("id", p.doctor_id).maybeSingle(),
    ctx.supabase.from("patient_deposits").select("id, ref, kind, amount, method, reference, created_at").eq("plan_id", p.id).order("created_at"),
    ctx.supabase.rpc("patient_advance", { p_patient: p.patient_id }),
    ctx.supabase.from("lab_cases").select("id, ref, plan_item_id, work_type, status, due_on, lab:suppliers(name_ar)").eq("plan_id", p.id).order("created_at"),
    ctx.can("lab.manage") ? ctx.supabase.from("suppliers").select("id, name_ar").eq("is_lab", true).eq("is_active", true).order("name_ar") : Promise.resolve({ data: [] }),
    ctx.supabase.from("payment_methods").select("code, name_ar, name_en, requires_reference").eq("is_active", true).not("code", "in", "(advance,online)"),
    ctx.supabase.from("specialties").select("id").eq("code", "dental").maybeSingle(),
  ]);
  const patientName = ((dir ?? []) as { full_name_ar: string; mrn: string }[])[0];
  const advance = ((adv ?? []) as { balance: number; available: number }[])[0];
  const canWrite = ctx.can("plan.write") && (p.doctor_id === ctx.staff?.id || ctx.can("clinical.read"));
  const canAccept = ctx.can("plan.accept");
  const active = ["accepted", "in_progress"].includes(p.status);
  const list = items ?? [];
  const unbilled = list.filter((i) => i.status === "done" && !i.invoice_id);
  const paid = (inst ?? []).reduce((a, i) => a + Number(i.paid_amount), 0);
  const nextDue = (inst ?? []).find((i) => Number(i.paid_amount) < Number(i.amount));

  // Draft editor: services of the plan's specialty with today's price in this branch.
  let services: { id: string; code: string; name: string; price: number | null }[] = [];
  if (p.status === "draft" && canWrite) {
    const [{ data: svc }, { data: prices }] = await Promise.all([
      ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("is_active", true).eq("is_package", false).eq("specialty_id", dental?.id ?? "").order("code"),
      ctx.supabase.from("price_list_items").select("service_id, price, effective, price_list:price_lists!inner(branch_id, is_default)")
        .eq("price_list.branch_id", p.branch_id).eq("price_list.is_default", true),
    ]);
    const inRange = (r: string) => { const m = /^[[(]([^,]*),([^)\]]*)[)\]]$/.exec(r); return !!m && (!m[1] || m[1] <= today) && (!m[2] || today < m[2]); };
    const priceOf = new Map(((prices ?? []) as unknown as { service_id: string; price: number; effective: string }[]).filter((x) => inRange(x.effective)).map((x) => [x.service_id, Number(x.price)]));
    services = (svc ?? []).map((x) => ({ id: x.id, code: x.code, name: ar ? x.name_ar : x.name_en, price: priceOf.get(x.id) ?? null }));
  }
  const ok = {
    created: ar ? "تم إنشاء مسودة الخطة." : "Draft plan created.", saved: ar ? "تم حفظ الخطة." : "Plan saved.", proposed: ar ? "صدر عرض السعر." : "Quotation issued.",
    revised: ar ? "عادت الخطة مسودة للتعديل." : "Back to draft for changes.", accepted: ar ? "تم تسجيل موافقة المريض وجدول الأقساط." : "Acceptance and installment schedule recorded.",
    cancelled: ar ? "تم إلغاء الخطة." : "Plan cancelled.", done: ar ? "تم تسجيل تنفيذ البند." : "Work recorded.", item_cancelled: ar ? "تم إلغاء البند." : "Item cancelled.",
    deposit: ar ? "تم تحصيل الدفعة وإضافتها للرصيد المقدم." : "Payment received into the advance balance.", lab_created: ar ? "تم إنشاء طلب المعمل." : "Lab case created.",
  }[searchParams.ok ?? ""];

  return (
    <>
      <PageHeader title={`${p.title} · ${patientName?.full_name_ar ?? ""}`}
        subtitle={[p.ref, p.quote_no, doc ? (ar ? doc.full_name_ar : doc.full_name_en ?? doc.full_name_ar) : null, label(PLAN_STATUS, p.status, ar)].filter(Boolean).join(" · ")}
        actions={<>{p.status !== "draft" && <PrintButton label={ar ? "طباعة عرض السعر" : "Print quotation"} />}
          {ctx.can("patient.read") && <Link href={`/os/patients/${p.patient_id}`} className="btn-ghost no-print">{ar ? "ملف المريض" : "Patient file"}</Link>}</>} />
      <Banner error={searchParams.error} success={ok} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "إجمالي الخطة" : "Plan total"} value={money(p.total, ctx.locale)} />
        <Stat label={ar ? "المدفوع على الأقساط" : "Paid on installments"} value={money(paid, ctx.locale)} tone="teal" />
        <Stat label={ar ? "الرصيد المقدم للمريض" : "Patient advance balance"} value={advance ? money(advance.available, ctx.locale) : "—"} tone="gold" />
        <Stat label={ar ? "الحالة" : "Status"} value={label(PLAN_STATUS, p.status, ar)} tone={p.status === "cancelled" ? "danger" : "navy"} />
      </div>

      {p.status === "draft" && canWrite ? (
        <>
          <form action={savePlan} className="card space-y-4 p-5 no-print">
            <input type="hidden" name="plan_id" value={p.id} />
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className="label" htmlFor="title">{ar ? "عنوان الخطة" : "Plan title"}</label><input id="title" name="title" required defaultValue={p.title} className="input" /></div>
              <div><label className="label" htmlFor="notes">{ar ? "ملاحظات تظهر في عرض السعر" : "Notes shown on the quotation"}</label><input id="notes" name="notes" defaultValue={p.notes ?? ""} className="input" /></div>
            </div>
            <PlanEditor ar={ar} services={services}
              initial={list.map((i) => ({ service_id: i.service_id, tooth: i.tooth ?? "", surfaces: i.surfaces ?? "", quantity: String(Number(i.quantity)), discount: Number(i.discount) ? String(Number(i.discount)) : "", lab_required: i.lab_required, notes: i.notes ?? "" }))} />
            <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "حفظ المسودة" : "Save draft"}</SubmitButton>
          </form>
          {list.length > 0 && (
            <form action={proposePlan} className="mt-4 flex flex-wrap items-end gap-2 no-print">
              <input type="hidden" name="plan_id" value={p.id} />
              <div><label className="label" htmlFor="valid_days">{ar ? "صلاحية العرض (أيام)" : "Quotation valid (days)"}</label><input id="valid_days" name="valid_days" type="number" min="1" max="180" defaultValue={30} className="input num w-28" /></div>
              <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "إصدار عرض السعر" : "Issue quotation"}</SubmitButton>
            </form>
          )}
        </>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
              <th className="th">#</th><th className="th">{ar ? "الخدمة" : "Service"}</th><th className="th">{ar ? "السن / الأسطح" : "Tooth / surfaces"}</th>
              <th className="th">{ar ? "السعر" : "Price"}</th><th className="th">{ar ? "خصم" : "Discount"}</th><th className="th">{ar ? "الإجمالي" : "Total"}</th>
              <th className="th">{ar ? "الحالة" : "Status"}</th><th className="th no-print"></th></tr></thead>
            <tbody className="divide-y divide-ivory-200">
              {list.map((i) => {
                const lab = (cases ?? []).find((c) => c.plan_item_id === i.id);
                return (
                  <tr key={i.id} className={i.status === "cancelled" ? "opacity-50" : ""} data-plan-item={i.seq}>
                    <td className="td num">{i.seq}</td>
                    <td className="td">{i.service ? (ar ? i.service.name_ar : i.service.name_en) : ""}<span className="block text-xs text-ink-300 num">{i.service?.code}{i.lab_required ? (ar ? " · يحتاج معمل" : " · lab work") : ""}</span></td>
                    <td className="td num">{[i.tooth, i.surfaces].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="td num">{money(Number(i.unit_price) * Number(i.quantity), ctx.locale)}</td>
                    <td className="td num">{Number(i.discount) ? money(i.discount, ctx.locale) : "—"}</td>
                    <td className="td num font-medium">{money(i.line_total, ctx.locale)}</td>
                    <td className="td">{label(ITEM_STATUS, i.status, ar)}{i.invoice_id && ctx.can("billing.read") ? <Link href={`/os/billing/${i.invoice_id}`} className="block text-xs text-teal-700 hover:underline">{ar ? "الفاتورة" : "Invoice"}</Link> : null}
                      {lab ? <span className="block text-xs text-ink-500">{lab.ref} · {label(LAB_STATUS, lab.status, ar)}</span> : null}{i.cancel_reason ? <span className="block text-xs text-ink-300">{i.cancel_reason}</span> : null}</td>
                    <td className="td no-print">
                      {active && i.status === "planned" && (
                        <div className="flex flex-wrap gap-1">
                          {canWrite && <form action={completeItem} data-item-done={i.seq}><input type="hidden" name="plan_id" value={p.id} /><input type="hidden" name="item_id" value={i.id} />
                            <SubmitButton pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "تم التنفيذ" : "Mark done"}</SubmitButton></form>}
                          {(canAccept || canWrite) && <form action={cancelItem} className="flex gap-1"><input type="hidden" name="plan_id" value={p.id} /><input type="hidden" name="item_id" value={i.id} />
                            <input name="reason" required placeholder={ar ? "سبب" : "Reason"} className="input w-24 py-1 text-xs" /><SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>}
                        </div>)}
                      {active && ctx.can("lab.manage") && i.status !== "cancelled" && !lab && (labs ?? []).length > 0 && (
                        <details className="mt-1"><summary className="cursor-pointer text-xs text-teal-700" data-lab-open={i.seq}>{ar ? "طلب معمل" : "Lab case"}</summary>
                          <form action={createLabCase} className="mt-2 grid gap-1">
                            <input type="hidden" name="plan_item_id" value={i.id} /><input type="hidden" name="back" value={`/os/plans/${p.id}`} />
                            <select name="lab_id" className="input py-1 text-xs">{(labs ?? []).map((l: { id: string; name_ar: string }) => <option key={l.id} value={l.id}>{l.name_ar}</option>)}</select>
                            <input name="work_type" required placeholder={ar ? "نوع العمل (تاج زيركون…)" : "Work (zirconia crown…)"} defaultValue={i.service ? (ar ? i.service.name_ar : i.service.name_en) : ""} className="input py-1 text-xs" />
                            <input name="shade" placeholder={ar ? "اللون (A2)" : "Shade (A2)"} className="input py-1 text-xs" />
                            <input name="due_on" type="date" min={today} className="input py-1 text-xs" />
                            <SubmitButton pendingLabel="…" className="btn-gold px-2 py-1 text-xs">{ar ? "إرسال الطلب" : "Create"}</SubmitButton>
                          </form></details>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-ivory-200">
              <tr><td className="td" colSpan={5}>{ar ? "الإجمالي بعد الخصم" : "Total after discount"}</td><td className="td num font-semibold">{money(p.total, ctx.locale)}</td><td className="td" colSpan={2}>
                {p.valid_until && p.status === "proposed" ? <span className="text-xs text-ink-500">{ar ? "العرض ساري حتى" : "Valid until"} <span className="num">{p.valid_until}</span></span> : null}</td></tr>
            </tfoot>
          </table>
          {p.notes && <p className="px-5 pb-4 text-sm text-ink-500">{p.notes}</p>}
        </div>
      )}

      {p.status === "proposed" && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3 no-print">
          {canAccept && (
            <form action={acceptPlan} className="card space-y-4 p-5 lg:col-span-2">
              <h2 className="font-medium text-navy-700">{ar ? "موافقة المريض وجدول الأقساط" : "Patient acceptance and installments"}</h2>
              <input type="hidden" name="plan_id" value={p.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="method">{ar ? "طريقة الموافقة" : "How the patient accepted"}</label>
                  <select id="method" name="method" className="input">{Object.entries(ACCEPT_METHOD).filter(([k]) => k !== "portal").map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></div>
                <div><label className="label" htmlFor="note">{ar ? "ملاحظة" : "Note"}</label><input id="note" name="note" className="input" /></div>
              </div>
              <InstallmentPlanner ar={ar} total={Number(p.total)} today={today} />
              <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "تسجيل الموافقة" : "Record acceptance"}</SubmitButton>
            </form>
          )}
          {canWrite && (
            <form action={revisePlan} className="card h-fit p-5"><input type="hidden" name="plan_id" value={p.id} />
              <p className="mb-3 text-sm text-ink-500">{ar ? "لتعديل البنود أو الأسعار أعد الخطة مسودة ثم أصدر عرضًا جديدًا." : "To change lines or prices, return to draft and issue a new quotation."}</p>
              <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "تعديل الخطة" : "Revise plan"}</SubmitButton></form>
          )}
        </div>
      )}

      {["accepted", "in_progress", "completed", "cancelled"].includes(p.status) && (inst ?? []).length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h2 className="mb-2 font-medium text-navy-700">{ar ? "جدول الأقساط" : "Installment schedule"}{p.acceptance_method ? <span className="text-sm font-normal text-ink-500"> · {label(ACCEPT_METHOD, p.acceptance_method, ar)}</span> : null}</h2>
            <table className="card w-full text-sm">
              <tbody className="divide-y divide-ivory-200">
                {(inst ?? []).map((i) => {
                  const done = Number(i.paid_amount) >= Number(i.amount);
                  const late = !done && i.due_on < today;
                  return (
                    <tr key={i.id} data-installment={i.seq}><td className="td num">{i.seq}</td><td className="td num">{i.due_on}</td><td className="td num">{money(i.amount, ctx.locale)}</td>
                      <td className="td num">{money(i.paid_amount, ctx.locale)}</td>
                      <td className={`td ${done ? "text-teal-700" : late ? "font-medium text-danger" : "text-ink-500"}`}>{done ? (ar ? "مدفوع" : "Paid") : late ? (ar ? "متأخر" : "Overdue") : (ar ? "مستحق" : "Due")}</td></tr>
                  );
                })}
              </tbody>
            </table>
            {(deps ?? []).length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-ink-500">
                {(deps ?? []).map((d: { id: string; ref: string; kind: string; amount: number; method: string; created_at: string }) => (
                  <li key={d.id}><span className="num">{d.ref}</span> · {money(d.amount, ctx.locale)} · {d.method} · {dateTime(d.created_at, ctx.locale)}</li>))}
              </ul>)}
          </section>
          <section className="space-y-4 no-print">
            {active && ctx.can("payment.collect") && (
              <form action={recordDeposit} className="card space-y-2 p-4">
                <h3 className="font-medium text-navy-700">{ar ? "تحصيل قسط / دفعة مقدمة" : "Receive an installment"}</h3>
                <input type="hidden" name="patient_id" value={p.patient_id} /><input type="hidden" name="plan_id" value={p.id} />
                <input type="hidden" name="back" value={`/os/plans/${p.id}`} /><input type="hidden" name="idempotency_key" value={randomUUID()} />
                <label className="label" htmlFor="dep_amount">{ar ? "المبلغ" : "Amount"}</label>
                <input id="dep_amount" name="amount" type="number" min="0.01" step="0.01" required defaultValue={nextDue ? Number(nextDue.amount) - Number(nextDue.paid_amount) : undefined} className="input num" />
                <label className="label" htmlFor="dep_method">{ar ? "الطريقة" : "Method"}</label>
                <select id="dep_method" name="method" className="input">{(methods ?? []).map((m: { code: string; name_ar: string; name_en: string }) => <option key={m.code} value={m.code}>{ar ? m.name_ar : m.name_en}</option>)}</select>
                <input name="reference" placeholder={ar ? "رقم المرجع (للبطاقة/التحويل)" : "Reference (card/transfer)"} className="input" dir="ltr" />
                <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تحصيل" : "Receive"}</SubmitButton>
              </form>)}
            {unbilled.length > 0 && ctx.can("billing.write") && (
              <form action={billPlan} className="card space-y-2 p-4"><input type="hidden" name="plan_id" value={p.id} />
                <p className="text-sm">{ar ? `${unbilled.length} بند تم تنفيذه ولم يُفوتر.` : `${unbilled.length} completed item(s) not yet billed.`}</p>
                <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "فوترة المُنفّذ وخصمه من الرصيد المقدم" : "Bill completed work and apply the advance"}</SubmitButton>
              </form>)}
          </section>
        </div>
      )}

      {!["completed", "cancelled"].includes(p.status) && (canAccept || canWrite) && p.status !== "draft" && (
        <form action={cancelPlan} className="mt-8 flex flex-wrap items-center gap-2 no-print"><input type="hidden" name="plan_id" value={p.id} />
          <input name="reason" required placeholder={ar ? "سبب إلغاء الخطة" : "Reason to cancel the plan"} className="input w-72" />
          <SubmitButton pendingLabel="…" className="btn-danger text-sm">{ar ? "إلغاء الخطة" : "Cancel plan"}</SubmitButton>
          <span className="text-xs text-ink-500">{ar ? "ما تم تنفيذه يبقى، والمدفوع يبقى رصيدًا مقدمًا للمريض قابلًا للاسترداد." : "Work done stays; money paid stays as a refundable advance."}</span>
        </form>
      )}
      {p.cancel_reason && <p className="mt-4 text-sm text-danger">{p.cancel_reason}</p>}
    </>
  );
}
