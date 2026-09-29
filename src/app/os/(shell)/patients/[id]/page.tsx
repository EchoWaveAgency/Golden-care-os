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
import { sellPackage } from "@/app/actions/packages";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; booked?: string } }) {
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
      <Banner error={searchParams.error} success={searchParams.booked ? (locale === "ar" ? "تم حجز الموعد." : "Appointment booked.") : undefined} />

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
                    <td className="td">{ctx.can("billing.read") && <Link href={`/os/billing/${k.invoice_id}`} className="num text-navy-700 hover:underline">{k.invoice_no}</Link>}</td>
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
