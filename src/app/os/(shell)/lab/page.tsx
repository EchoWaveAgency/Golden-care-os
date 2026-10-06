import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { LAB_NEXT, LAB_STATUS, label } from "@/lib/dental";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { recordSupplierBill, setLabStatus } from "@/app/actions/dental";

export const dynamic = "force-dynamic";

type Case = { id: string; ref: string; patient_id: string; plan_id: string | null; lab_id: string; work_type: string; teeth: string | null; shade: string | null; due_on: string | null;
  status: string; remakes: number; cost: number; created_at: string; lab: { name_ar: string } | null; doctor: { full_name_ar: string; full_name_en: string | null } | null };

export default async function LabPage({ searchParams }: { searchParams: { error?: string; ok?: string; all?: string } }) {
  const ctx = await requireAny("lab.read", "lab.manage");
  const ar = ctx.locale === "ar";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  let q = ctx.supabase.from("lab_cases").select("id, ref, patient_id, plan_id, lab_id, work_type, teeth, shade, due_on, status, remakes, cost, created_at, lab:suppliers(name_ar), doctor:staff(full_name_ar, full_name_en)")
    .order("due_on", { ascending: true, nullsFirst: false }).limit(200);
  if (!searchParams.all) q = q.not("status", "in", "(delivered,cancelled)");
  const { data } = await q.returns<Case[]>();
  const cases = data ?? [];
  const { data: dir } = cases.length ? await ctx.supabase.rpc("patient_directory", { p_ids: Array.from(new Set(cases.map((c) => c.patient_id))) }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; full_name_ar: string }[]).map((p) => [p.id, p.full_name_ar]));
  const late = cases.filter((c) => c.due_on && c.due_on < today && !["delivered", "cancelled"].includes(c.status));
  const ok = { lab_updated: ar ? "تم تحديث حالة الطلب." : "Lab case updated.", bill: ar ? "تم تسجيل فاتورة المعمل (مصروف ومستحق للمورد)." : "Lab bill recorded (expense and supplier payable).",
    lab_created: ar ? "تم إنشاء طلب المعمل." : "Lab case created." }[searchParams.ok ?? ""];
  const canManage = ctx.can("lab.manage");
  const canBill = ctx.can("supplier.bill.record");

  return (
    <>
      <PageHeader title={ar ? "معامل الأسنان" : "Dental lab cases"}
        subtitle={ar ? "كل طلب: مطلوب ← أُرسل ← في المعمل ← عاد ← سُلّم، مع إعادة التصنيع والمواعيد وتكلفة فاتورة المعمل." : "Each case: ordered → sent → in the lab → returned → delivered, with remakes, due dates and the lab bill."}
        actions={<Link href={searchParams.all ? "/os/lab" : "/os/lab?all=1"} className="btn-ghost">{searchParams.all ? (ar ? "المفتوحة فقط" : "Open only") : (ar ? "عرض الكل" : "Show all")}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "طلبات مفتوحة" : "Open cases"} value={cases.filter((c) => !["delivered", "cancelled"].includes(c.status)).length} />
        <Stat label={ar ? "متأخرة عن موعدها" : "Past due"} value={late.length} tone={late.length ? "danger" : "teal"} />
        <Stat label={ar ? "عادت وتنتظر التسليم" : "Back, to deliver"} value={cases.filter((c) => c.status === "returned").length} tone="gold" />
        <Stat label={ar ? "تكلفة المعامل (المعروض)" : "Lab cost (listed)"} value={money(cases.reduce((a, c) => a + Number(c.cost), 0), ctx.locale)} />
      </div>
      <div className="space-y-3">
        {cases.length === 0 && <p className="card p-5 text-sm text-ink-300">{ctx.t("common.none")}</p>}
        {cases.map((c) => {
          const isLate = c.due_on && c.due_on < today && !["delivered", "cancelled"].includes(c.status);
          return (
            <article key={c.id} className={`card p-4 ${isLate ? "border-danger/40" : ""}`} data-lab-case={c.ref}>
              <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                <div>
                  <p><span className="num font-medium text-navy-700">{c.ref}</span> · {names.get(c.patient_id) ?? ""}{c.plan_id ? <> · <Link href={`/os/plans/${c.plan_id}`} className="text-teal-700 hover:underline">{ar ? "الخطة" : "plan"}</Link></> : null}</p>
                  <p className="mt-1 font-medium">{c.work_type}{c.teeth ? <> · <span className="num">{c.teeth}</span></> : null}{c.shade ? <> · <bdi>{c.shade}</bdi></> : null}</p>
                  <p className="text-xs text-ink-500">{c.lab?.name_ar} · {c.doctor ? (ar ? c.doctor.full_name_ar : c.doctor.full_name_en ?? c.doctor.full_name_ar) : ""}{c.remakes ? ` · ${ar ? "إعادة" : "remakes"} ${c.remakes}` : ""}</p>
                </div>
                <div className="text-end">
                  <p className={isLate ? "font-medium text-danger" : ""}>{label(LAB_STATUS, c.status, ar)}</p>
                  <p className="text-xs text-ink-500">{c.due_on ? <>{ar ? "الموعد" : "Due"} <span className="num">{c.due_on}</span></> : null}{Number(c.cost) ? <>{c.due_on ? " · " : ""}<span className="num">{money(c.cost, ctx.locale)}</span></> : null}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {canManage && LAB_NEXT[c.status]?.length > 0 && (
                  <form action={setLabStatus} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="case_id" value={c.id} />
                    <input name="note" placeholder={ar ? "ملاحظة (مطلوبة للإعادة/الإلغاء)" : "Note (needed for remake/cancel)"} className="input w-56 py-1 text-xs" />
                    {LAB_NEXT[c.status].map((n) => (
                      <SubmitButton key={n} name="status" value={n} pendingLabel="…" className={n === "cancelled" || n === "remake" ? "btn-ghost px-2 py-1 text-xs" : "btn-primary px-2 py-1 text-xs"}>{label(LAB_STATUS, n, ar)}</SubmitButton>))}
                  </form>)}
                {canBill && c.status !== "cancelled" && (
                  <details key={`bill-${c.id}-${c.cost}`}><summary className="cursor-pointer text-xs text-teal-700" data-lab-bill={c.ref}>{ar ? "تسجيل فاتورة المعمل" : "Record the lab bill"}</summary>
                    <form action={recordSupplierBill} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="kind" value="lab" /><input type="hidden" name="lab_case_id" value={c.id} /><input type="hidden" name="supplier_id" value={c.lab_id} />
                      <input name="bill_no" required placeholder={ar ? "رقم فاتورة المعمل" : "Lab invoice no."} className="input w-36 py-1 text-xs" dir="ltr" />
                      <input name="amount" type="number" min="0.01" step="0.01" required placeholder={ar ? "المبلغ" : "Amount"} className="input num w-28 py-1 text-xs" />
                      <input name="bill_date" type="date" max={today} defaultValue={today} className="input py-1 text-xs" />
                      <SubmitButton pendingLabel="…" className="btn-gold px-2 py-1 text-xs">{ar ? "تسجيل" : "Record"}</SubmitButton>
                    </form></details>)}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
