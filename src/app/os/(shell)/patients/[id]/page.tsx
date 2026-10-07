import { createReferralCode, setReferrer } from "@/app/actions/loyalty";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money, rangeStart } from "@/lib/format";
import { patientName, type AppointmentRow, type InvoiceRow, type PatientRow } from "@/lib/types";
import { createInvoice } from "@/app/actions/billing";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import type { DictKey } from "@/lib/i18n";
import { PortalCard } from "./PortalCard";
import { PACKAGE_STATUS, label, type PackageBalance } from "@/lib/devices";
import { requestPackageRefund, sellPackage, transferPackage } from "@/app/actions/packages";
import { PLAN_STATUS, label as dlabel } from "@/lib/dental";
import { recordDeposit, requestDepositRefund, savePlan } from "@/app/actions/dental";
import { CARE_KIND, CARE_OUTCOME, CARE_STATUS, lbl } from "@/lib/care/labels";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; booked?: string; ok?: string } }) {
  const ctx = await requireAny("patient.read", "patient.read.assigned");
  const { t, locale } = ctx;

  const { data: p } = await ctx.supabase.from("patients").select("*").eq("id", params.id).maybeSingle<PatientRow>();
  if (!p) notFound();

  const [{ data: flags }, { data: apts }, invoicesRes] = await Promise.all([
    ctx.supabase.rpc("patient_alert_flags", { p_patient: p.id }),
    ctx.supabase
      .from("appointments")
      .select("id, ref, slot, status, queue_no, patient_id, doctor_id, channel, doctor:staff(full_name_ar, full_name_en)")
      .eq("patient_id", p.id)
      .order("slot", { ascending: false })
      .limit(20)
      .returns<AppointmentRow[]>(),
    ctx.can("billing.read")
      ? ctx.supabase.from("invoices").select("*").eq("patient_id", p.id).order("created_at", { ascending: false }).limit(20).returns<InvoiceRow[]>()
      : Promise.resolve({ data: [] as InvoiceRow[] }),
  ]);
  const invoices = invoicesRes.data ?? [];
  const showPackages = ctx.can("package.read") || ctx.can("package.sell") || ctx.can("laser.operate");
  const [{ data: pkgData }, { data: tplData }] = await Promise.all([
    showPackages ? ctx.supabase.rpc("patient_package_balances", { p_patient: p.id }) : Promise.resolve({ data: [] }),
    ctx.can("package.sell") ? ctx.supabase.from("package_templates").select("id, name_ar, name_en, sessions, price").eq("is_active", true).order("code") : Promise.resolve({ data: [] }),
  ]);
  const pkgs = (pkgData ?? []) as PackageBalance[];
  const tpls = (tplData ?? []) as { id: string; name_ar: string; name_en: string; sessions: number; price: number }[];
  const showPlans = ctx.can("plan.write") || ctx.can("plan.accept") || ctx.can("billing.read");
  const showAdvance = ctx.can("payment.collect") || ctx.can("billing.read") || ctx.can("plan.accept");
  const [{ data: plans }, { data: advData }, { data: depHist }, { data: depMethods }] = await Promise.all([
    showPlans ? ctx.supabase.from("treatment_plans").select("id, ref, title, status, total, created_at").eq("patient_id", p.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    showAdvance ? ctx.supabase.rpc("patient_advance", { p_patient: p.id }) : Promise.resolve({ data: [] }),
    showAdvance ? ctx.supabase.from("patient_deposits").select("id, ref, kind, amount, method, created_at").eq("patient_id", p.id).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    ctx.can("payment.collect") || ctx.can("refund.request") ? ctx.supabase.from("payment_methods").select("code, name_ar, name_en").eq("is_active", true).not("code", "in", "(advance,online,loyalty)") : Promise.resolve({ data: [] }),
  ]);
  const adv = ((advData ?? []) as { balance: number; available: number }[])[0];
  const { data: loyData } = await ctx.supabase.rpc("patient_loyalty", { p_patient: p.id });
  const loy = loyData as { enabled: boolean; points: number; value: number; referral_code: string | null; referred_by: string | null; referrals: number } | null;
  const { data: careRows } = ctx.can("care.read")
    ? await ctx.supabase.from("care_journeys").select("id, ref, kind, status, outcome, channel, scheduled_at, closed_at").eq("patient_id", p.id).order("created_at", { ascending: false }).limit(10)
    : { data: [] };
  const methodsList = (depMethods ?? []) as { code: string; name_ar: string; name_en: string }[];
  const refundMethods = methodsList;
  const kindLabel = (k: string) => ({ deposit: locale === "ar" ? "دفعة مقدمة" : "Advance", applied: locale === "ar" ? "خُصم على فاتورة" : "Applied to invoice", refund: locale === "ar" ? "مُسترد" : "Refunded" }[k] ?? k);
  const alerts = (flags ?? []) as { kind: string; severity: string; n: number }[];

  return (
    <>
      <PageHeader
        title={patientName(p, locale)}
        subtitle={`${p.mrn} · ${p.phone}`}
        actions={
          <>
            {ctx.can("appointment.write") && <Link href={`/os/appointments/new?patient=${p.id}`} className="btn-primary">{t("apt.new")}</Link>}
            {ctx.can("billing.write") && (
              <form action={createInvoice}>
                <input type="hidden" name="patient_id" value={p.id} />
                <SubmitButton pendingLabel="…" className="btn-gold">{t("bill.new")}</SubmitButton>
              </form>
            )}
          </>
        }
      />
      <Banner error={searchParams.error} success={searchParams.booked ? (locale === "ar" ? "تم حجز الموعد." : "Appointment booked.")
        : searchParams.ok === "deposit" ? (locale === "ar" ? "تم تحصيل الدفعة المقدمة." : "Advance received.")
        : searchParams.ok === "refund_requested" ? (locale === "ar" ? "تم إرسال طلب الاسترداد للاعتماد." : "Refund request sent for approval.")
        : searchParams.ok === "package_refund_requested" ? (locale === "ar" ? "تم إرسال طلب استرداد الباقة للاعتماد." : "Package refund request sent for approval.")
        : searchParams.ok === "package_transferred" ? (locale === "ar" ? "تم تحويل الجلسات المتبقية للمريض الآخر." : "Remaining sessions transferred.")
        : searchParams.ok === "referrer_set" ? (locale === "ar" ? "تم تسجيل من رشّح المريض." : "Referrer recorded.")
        : searchParams.ok === "referral_code" ? (locale === "ar" ? "تم إنشاء كود الدعوة." : "Invite code created.") : undefined} />

      {alerts.length > 0 && (
        <div role="note" className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-danger/20 bg-danger-50 px-4 py-3">
          <span className="text-sm font-medium text-danger">{t("patient.alerts")}:</span>
          {alerts.map((a) => (
            <span key={a.kind} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-danger">
              {t(`patient.alert.${a.kind}` as DictKey)} {a.n > 1 ? `×${a.n}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-1">
          <dl className="space-y-3 text-sm">
            <Row k={t("patient.mrn")} v={p.mrn} num />
            <Row k={t("patient.phone")} v={p.phone} num />
            <Row k={t("patient.nationalId")} v={p.national_id ? `••••••••••${p.national_id.slice(-4)}` : "—"} num />
            <Row k={t("patient.dob")} v={p.date_of_birth ?? "—"} num />
            <Row k={t("patient.sex")} v={t(`patient.sex.${p.sex}` as DictKey)} />
            <Row k={t("patient.channel")} v={p.preferred_channel} />
            {p.first_name_en && <Row k="English" v={`${p.first_name_en} ${p.last_name_en ?? ""}`} />}
          </dl>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{t("patient.visits")}</h2>
          {(apts ?? []).length === 0 ? <Empty text={t("common.none")} /> : (
            <ul className="divide-y divide-ivory-200">
              {(apts ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium whitespace-nowrap">{dateTime(rangeStart(a.slot), locale)}</p>
                    <p className="text-xs text-ink-500">{locale === "en" ? a.doctor?.full_name_en ?? a.doctor?.full_name_ar : a.doctor?.full_name_ar} · <span className="num">{a.ref}</span></p>
                  </div>
                  <StatusBadge status={a.status} label={t(`apt.status.${a.status}` as DictKey)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {ctx.can("billing.read") && (
          <section className="card lg:col-span-3">
            <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{t("patient.invoices")}</h2>
            {invoices.length === 0 ? <Empty text={t("common.none")} /> : (
              <table className="w-full">
                <tbody className="divide-y divide-ivory-200">
                  {invoices.map((i) => (
                    <tr key={i.id} className="hover:bg-ivory-50">
                      <td className="td"><Link href={`/os/billing/${i.id}`} className="num text-navy-700 hover:underline">{i.invoice_no ?? t("bill.draft")}</Link></td>
                      <td className="td text-ink-500 whitespace-nowrap">{dateTime(i.created_at, locale, { timeStyle: undefined })}</td>
                      <td className="td num">{money(i.total, locale)}</td>
                      <td className="td num text-ink-500">{t("bill.balance")}: {money(i.balance, locale)}</td>
                      <td className="td"><StatusBadge status={i.status} label={t(`bill.status.${i.status}` as DictKey)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {(careRows ?? []).length > 0 && (
          <section className="card lg:col-span-3" data-care>
            <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{locale === "ar" ? "مساعد المتابعة" : "Care assistant"}</h2>
            <ul className="divide-y divide-ivory-200 text-sm">
              {(careRows ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                  <Link href={`/os/care/${c.id}`} className="text-teal-700 hover:underline">{lbl(CARE_KIND, c.kind, locale === "ar")} <span className="num text-xs text-ink-300">{c.ref}</span></Link>
                  <span className="text-xs text-ink-500">{lbl(CARE_STATUS, c.status, locale === "ar")}{c.outcome ? ` · ${lbl(CARE_OUTCOME, c.outcome, locale === "ar")}` : ""} · {dateTime(c.closed_at ?? c.scheduled_at, locale)}</span>
                </li>))}
            </ul>
          </section>
        )}
        {showPlans && (
          <section className="card lg:col-span-3" data-plans>
            <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{locale === "ar" ? "خطط العلاج" : "Treatment plans"}</h2>
            {(plans ?? []).length === 0 ? <Empty text={t("common.none")} /> : (
              <ul className="divide-y divide-ivory-200 text-sm">
                {(plans ?? []).map((pl: { id: string; ref: string; title: string; status: string; total: number }) => (
                  <li key={pl.id} className="flex justify-between px-5 py-2"><Link href={`/os/plans/${pl.id}`} className="text-navy-700 hover:underline">{pl.title} <span className="num text-xs text-ink-300">{pl.ref}</span></Link>
                    <span className="num">{money(pl.total, locale)} <span className="text-xs text-ink-500">{dlabel(PLAN_STATUS, pl.status, locale === "ar")}</span></span></li>))}
              </ul>)}
            {ctx.can("plan.write") && ctx.staff?.kind === "doctor" && (
              <form action={savePlan} className="flex flex-wrap items-end gap-2 border-t border-ivory-200 p-4">
                <input type="hidden" name="patient_id" value={p.id} />
                <div><label className="label" htmlFor="plan_title">{locale === "ar" ? "خطة علاج جديدة" : "New treatment plan"}</label>
                  <input id="plan_title" name="title" required placeholder={locale === "ar" ? "مثال: حشو وتاج" : "e.g. filling and crown"} className="input w-64" /></div>
                <SubmitButton pendingLabel="…" className="btn-primary">{locale === "ar" ? "إنشاء" : "Create"}</SubmitButton>
              </form>)}
          </section>
        )}
        {showAdvance && adv && (
          <section className="card lg:col-span-3" data-advance>
            <h2 className="flex justify-between border-b border-ivory-200 px-5 py-3 font-medium text-navy-700"><span>{locale === "ar" ? "الرصيد المقدم" : "Advance balance"}</span>
              <span className="num" data-advance-balance>{money(adv.available, locale)}</span></h2>
            {(depHist ?? []).length > 0 && (
              <ul className="divide-y divide-ivory-200 text-xs">
                {(depHist ?? []).map((d: { id: string; ref: string; kind: string; amount: number; method: string; created_at: string }) => (
                  <li key={d.id} className="flex justify-between px-5 py-2"><span><span className="num">{d.ref}</span> · {kindLabel(d.kind)}</span>
                    <span className="num">{d.kind === "deposit" ? "+" : "−"}{money(d.amount, locale)} <span className="text-ink-300">{dateTime(d.created_at, locale)}</span></span></li>))}
              </ul>)}
            <div className="flex flex-wrap gap-6 border-t border-ivory-200 p-4">
              {ctx.can("payment.collect") && (
                <form action={recordDeposit} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="patient_id" value={p.id} /><input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <div><label className="label" htmlFor="dep_amount">{locale === "ar" ? "دفعة مقدمة" : "Receive an advance"}</label><input id="dep_amount" name="amount" type="number" min="0.01" step="0.01" required className="input num w-28" /></div>
                  <select name="method" className="input w-36" aria-label={locale === "ar" ? "الطريقة" : "Method"}>{methodsList.map((m) => <option key={m.code} value={m.code}>{locale === "ar" ? m.name_ar : m.name_en}</option>)}</select>
                  <input name="reference" placeholder={locale === "ar" ? "مرجع" : "Reference"} className="input w-28" dir="ltr" />
                  <SubmitButton pendingLabel="…" className="btn-gold">{locale === "ar" ? "تحصيل" : "Receive"}</SubmitButton>
                </form>)}
              {ctx.can("refund.request") && Number(adv.available) > 0 && (
                <form action={requestDepositRefund} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="patient_id" value={p.id} />
                  <div><label className="label" htmlFor="ref_amount">{locale === "ar" ? "طلب استرداد من الرصيد" : "Request a refund"}</label><input id="ref_amount" name="amount" type="number" min="0.01" max={Number(adv.available)} step="0.01" required className="input num w-28" /></div>
                  <select name="method" className="input w-36" aria-label={locale === "ar" ? "الطريقة" : "Method"}>{methodsList.map((m) => <option key={m.code} value={m.code}>{locale === "ar" ? m.name_ar : m.name_en}</option>)}</select>
                  <input name="reason" required placeholder={locale === "ar" ? "السبب" : "Reason"} className="input w-40" />
                  <SubmitButton pendingLabel="…" className="btn-ghost">{locale === "ar" ? "إرسال للاعتماد" : "Send for approval"}</SubmitButton>
                </form>)}
            </div>
          </section>
        )}
        {loy?.enabled && (
          <section className="card p-5 text-sm lg:col-span-3" data-loyalty>
            <h2 className="mb-2 font-medium text-navy-700">{locale === "ar" ? "نقاط الولاء والدعوات" : "Loyalty and referrals"}</h2>
            <p><span className="num font-semibold text-navy-700">{loy.points}</span> {locale === "ar" ? "نقطة" : "points"} (<span className="num">{money(loy.value, locale)}</span>)
              {" · "}{locale === "ar" ? "دعوات ناجحة:" : "referrals:"} <span className="num">{loy.referrals}</span>
              {loy.referred_by && <>{" · "}{locale === "ar" ? "رشّحه:" : "referred by:"} <span className="num">{loy.referred_by}</span></>}</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {loy.referral_code ? <span>{locale === "ar" ? "كود الدعوة:" : "Invite code:"} <span className="num font-semibold" dir="ltr">{loy.referral_code}</span></span>
                : ctx.can("patient.write") && <form action={createReferralCode}><input type="hidden" name="patient_id" value={p.id} /><SubmitButton pendingLabel="…" className="btn-ghost text-xs">{locale === "ar" ? "إنشاء كود دعوة" : "Create invite code"}</SubmitButton></form>}
              {!loy.referred_by && ctx.can("patient.write") && (
                <form action={setReferrer} className="flex items-center gap-2" data-set-referrer><input type="hidden" name="patient_id" value={p.id} />
                  <input name="code" required placeholder={locale === "ar" ? "كود من رشّحه" : "Referrer's code"} className="input w-36 py-1 text-xs" dir="ltr" />
                  <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{locale === "ar" ? "تسجيل" : "Record"}</SubmitButton></form>)}
            </div>
          </section>)}
        {showPackages && (
          <section className="card lg:col-span-3" data-packages>
            <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{locale === "ar" ? "الباقات" : "Packages"}</h2>
            {pkgs.length === 0 ? <Empty text={t("common.none")} /> : (
              <table className="w-full text-sm"><tbody className="divide-y divide-ivory-200">
                {pkgs.map((k) => (
                  <tr key={k.id}>
                    <td className="td"><span className="num font-medium">{k.ref}</span> · {locale === "ar" ? k.name_ar : k.name_en}</td>
                    <td className="td num">{locale === "ar" ? "متبقي" : "Left"} {k.units_total - k.units_used}/{k.units_total}</td>
                    <td className="td num text-ink-500">{locale === "ar" ? "تنتهي" : "Expires"} {k.expires_on}</td>
                    <td className="td">{label(PACKAGE_STATUS, k.status, locale === "ar")}{!k.paid && k.status === "active" ? <span className="text-warn"> · {locale === "ar" ? "غير مسددة" : "unpaid"}</span> : null}</td>
                    <td className="td">{ctx.can("billing.read") && <Link href={`/os/billing/${k.invoice_id}`} className="num text-navy-700 hover:underline">{k.invoice_no}</Link>}
                      {k.status === "active" && k.paid && (ctx.can("refund.request") || ctx.can("package.manage")) && (
                        <details className="mt-1 text-xs" data-package-actions={k.ref}><summary className="cursor-pointer text-teal-700">{locale === "ar" ? "استرداد / تحويل" : "Refund / transfer"}</summary>
                          {ctx.can("refund.request") && (
                            <form action={requestPackageRefund} className="mt-2 flex flex-wrap items-end gap-2" data-package-refund>
                              <input type="hidden" name="patient_id" value={p.id} /><input type="hidden" name="package_id" value={k.id} />
                              <span className="text-ink-500">{locale === "ar" ? "غير المستخدم" : "Unused"} <span className="num">{money(k.value_total - k.value_used, locale)}</span></span>
                              <input name="fee" type="number" min="0" step="0.01" defaultValue={0} title={locale === "ar" ? "رسوم إدارية تحتفظ بها العيادة" : "Admin fee kept by the clinic"} className="input num w-24 py-1 text-xs" />
                              <select name="method" className="input w-28 py-1 text-xs">{refundMethods.map((m) => <option key={m.code} value={m.code}>{locale === "ar" ? m.name_ar : m.name_en}</option>)}</select>
                              <input name="reason" required placeholder={locale === "ar" ? "السبب" : "Reason"} className="input w-40 py-1 text-xs" />
                              <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{locale === "ar" ? "طلب استرداد" : "Request refund"}</SubmitButton></form>)}
                          {ctx.can("package.manage") && (
                            <form action={transferPackage} className="mt-2 flex flex-wrap items-end gap-2" data-package-transfer>
                              <input type="hidden" name="patient_id" value={p.id} /><input type="hidden" name="package_id" value={k.id} />
                              <input name="mrn" required placeholder={locale === "ar" ? "رقم ملف المريض المستلم" : "Receiving patient's file no."} className="input w-44 py-1 text-xs" dir="ltr" />
                              <input name="reason" required placeholder={locale === "ar" ? "السبب" : "Reason"} className="input w-40 py-1 text-xs" />
                              <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{locale === "ar" ? "تحويل الجلسات المتبقية" : "Transfer remaining sessions"}</SubmitButton></form>)}
                        </details>)}</td>
                  </tr>))}
              </tbody></table>
            )}
            {ctx.can("package.sell") && tpls.length > 0 && (
              <form action={sellPackage} className="flex flex-wrap items-end gap-2 border-t border-ivory-200 p-4">
                <input type="hidden" name="patient_id" value={p.id} />
                <input type="hidden" name="idempotency_key" value={randomUUID()} />
                <div><label className="label" htmlFor="template_id">{locale === "ar" ? "بيع باقة" : "Sell a package"}</label>
                  <select id="template_id" name="template_id" className="input">
                    {tpls.map((x) => <option key={x.id} value={x.id}>{locale === "ar" ? x.name_ar : x.name_en} · {x.sessions} · {money(x.price, locale)}</option>)}</select></div>
                <div><label className="label" htmlFor="discount">{locale === "ar" ? "خصم" : "Discount"}</label><input id="discount" name="discount" type="number" min="0" step="0.01" defaultValue={0} className="input num w-28" /></div>
                <SubmitButton pendingLabel="…" className="btn-gold">{locale === "ar" ? "بيع وإصدار الفاتورة" : "Sell and issue invoice"}</SubmitButton>
              </form>
            )}
          </section>
        )}
        <PortalCard ctx={ctx} patientId={p.id} />
      </div>
    </>
  );
}

function Row({ k, v, num }: { k: string; v: string; num?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-500">{k}</dt>
      <dd className={num ? "num" : ""}>{v}</dd>
    </div>
  );
}
