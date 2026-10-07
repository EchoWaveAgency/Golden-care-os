import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, clinicLocalToIso, timeOnly, rangeStart } from "@/lib/format";
import { NEXT_STATUS, primaryAction, isActive } from "@/lib/appointments";
import { patientName, type AppointmentRow } from "@/lib/types";
import { transitionAppointment } from "@/app/actions/appointments";
import { createInvoice } from "@/app/actions/billing";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import type { DictKey } from "@/lib/i18n";

export const metadata = { title: "Reception" };
export const dynamic = "force-dynamic";

export default async function ReceptionPage({ searchParams }: { searchParams: { error?: string; day?: string } }) {
  const ctx = await requireAny("appointment.write", "appointment.read");
  const { t, locale } = ctx;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? "") ? searchParams.day! : clinicToday();
  const from = clinicLocalToIso(day, "00:00");
  const to = new Date(new Date(from).getTime() + 24 * 3600_000).toISOString();

  const { data } = await ctx.supabase
    .from("appointments")
    .select("id, ref, slot, status, queue_no, patient_id, doctor_id, channel, patient:patients(id, mrn, first_name_ar, last_name_ar, phone), doctor:staff(full_name_ar, full_name_en)")
    .eq("branch_id", ctx.branchId!)
    .overlaps("slot", `[${from},${to})`)
    .order("slot")
    .returns<AppointmentRow[]>();
  const rows = data ?? [];
  const count = (f: (s: AppointmentRow["status"]) => boolean) => rows.filter((r) => f(r.status)).length;
  const canWrite = ctx.can("appointment.write");
  const canBill = ctx.can("billing.write");

  return (
    <>
      <PageHeader
        title={t("nav.reception")}
        subtitle={`${t("apt.today")} · ${day}`}
        actions={
          <>
            <form className="flex items-center gap-2">
              <input type="date" name="day" defaultValue={day} className="input w-auto" aria-label={t("common.date")} />
              <button className="btn-ghost">{t("common.search")}</button>
            </form>
            <a href={`/os/print/day-sheet?day=${day}`} data-day-sheet-link className="btn-ghost">{locale === "ar" ? "طباعة ورقة اليوم" : "Print day sheet"}</a>
            {canWrite && <Link href="/os/patients/new" className="btn-ghost">{t("patient.new")}</Link>}
            {canWrite && <Link href="/os/patients" className="btn-primary">{t("apt.new")}</Link>}
          </>
        }
      />
      <Banner error={searchParams.error} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("exec.appointments")} value={count(isActive)} />
        <Stat label={t("exec.arrived")} value={count((s) => ["arrived", "waiting"].includes(s))} tone="teal" />
        <Stat label={t("apt.status.in_consultation")} value={count((s) => ["in_consultation", "procedure_in_progress"].includes(s))} tone="teal" />
        <Stat label={t("apt.status.awaiting_payment")} value={count((s) => s === "awaiting_payment")} tone="gold" />
        <Stat label={t("exec.completed")} value={count((s) => s === "completed")} />
      </div>

      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{t("common.time")}</th>
                <th className="th">{t("apt.queue")}</th>
                <th className="th">{t("apt.patient")}</th>
                <th className="th">{t("apt.doctor")}</th>
                <th className="th">{t("common.status")}</th>
                <th className="th">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((a) => {
                const primary = primaryAction(a.status);
                const others = NEXT_STATUS[a.status].filter((s) => s !== primary && !["canceled", "pending_confirmation", "booked"].includes(s));
                return (
                  <tr key={a.id} className={isActive(a.status) ? "" : "opacity-60"}>
                    <td className="td font-medium whitespace-nowrap">{timeOnly(rangeStart(a.slot), locale)}</td>
                    <td className="td num text-lg font-semibold text-gold-700">{a.queue_no ?? "—"}</td>
                    <td className="td">
                      <Link href={`/os/patients/${a.patient_id}`} className="font-medium text-navy-700 hover:underline">{patientName(a.patient, locale)}</Link>
                      <p className="num text-xs text-ink-300">{a.patient?.mrn} · {a.patient?.phone}</p>
                    </td>
                    <td className="td text-ink-500">{locale === "en" ? a.doctor?.full_name_en ?? a.doctor?.full_name_ar : a.doctor?.full_name_ar}</td>
                    <td className="td"><StatusBadge status={a.status} label={t(`apt.status.${a.status}` as DictKey)} /></td>
                    <td className="td">
                      {canWrite && (
                        <div className="flex flex-wrap items-center gap-2">
                          {primary && (
                            <form action={transitionAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="to" value={primary} />
                              <SubmitButton pendingLabel="…" className="btn-primary !px-3 !py-1.5">{t(`apt.action.${primary}` as DictKey)}</SubmitButton>
                            </form>
                          )}
                          {others.map((s) => (
                            <form key={s} action={transitionAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="to" value={s} />
                              <SubmitButton pendingLabel="…" className="btn-ghost !px-3 !py-1.5">{t(`apt.action.${s}` as DictKey)}</SubmitButton>
                            </form>
                          ))}
                          {a.status === "awaiting_payment" && canBill && (
                            <form action={createInvoice}>
                              <input type="hidden" name="patient_id" value={a.patient_id} />
                              <input type="hidden" name="appointment_id" value={a.id} />
                              <SubmitButton pendingLabel="…" className="btn-gold !px-3 !py-1.5">{t("bill.new")}</SubmitButton>
                            </form>
                          )}
                          {NEXT_STATUS[a.status].includes("canceled") && (
                            <details className="relative">
                              <summary className="btn-ghost cursor-pointer list-none !px-3 !py-1.5 text-danger">{t("apt.action.canceled")}</summary>
                              <form action={transitionAppointment} className="card absolute z-10 mt-1 w-64 space-y-2 p-3 ltr:right-0 rtl:left-0">
                                <input type="hidden" name="id" value={a.id} />
                                <input type="hidden" name="to" value="canceled" />
                                <label className="label">{t("apt.cancelReason")}</label>
                                <input name="reason" required className="input" />
                                <SubmitButton pendingLabel="…" className="btn-danger w-full">{t("apt.action.canceled")}</SubmitButton>
                              </form>
                            </details>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
