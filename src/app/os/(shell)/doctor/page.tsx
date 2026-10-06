import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, clinicLocalToIso, timeOnly, rangeStart } from "@/lib/format";
import { isActive } from "@/lib/appointments";
import { patientName, type AppointmentRow } from "@/lib/types";
import { openEncounter } from "@/app/actions/clinical";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import type { DictKey } from "@/lib/i18n";
import { patientNames } from "@/lib/care/people";
import { pick } from "@/lib/care/labels";

export const metadata = { title: "My clinic" };
export const dynamic = "force-dynamic";

export default async function DoctorPage({ searchParams }: { searchParams: { error?: string } }) {
  const ctx = await requireAny("clinical.write.own");
  const { t, locale } = ctx;
  const day = clinicToday();
  const from = clinicLocalToIso(day, "00:00");
  const to = new Date(new Date(from).getTime() + 24 * 3600_000).toISOString();

  const { data } = ctx.staff
    ? await ctx.supabase
        .from("appointments")
        .select("id, ref, slot, status, queue_no, patient_id, doctor_id, channel, patient:patients(id, mrn, first_name_ar, last_name_ar, phone)")
        .eq("doctor_id", ctx.staff.id)
        .overlaps("slot", `[${from},${to})`)
        .order("slot")
        .returns<AppointmentRow[]>()
    : { data: [] as AppointmentRow[] };
  const rows = (data ?? []).filter((a) => isActive(a.status));
  // Care assistant escalations about this doctor's patients (RLS: the doctor's own only).
  const { data: escs } = ctx.staff
    ? await ctx.supabase.from("care_escalations").select("id, ref, severity, category, summary, patient_text, due_at, journey_id, patient_id")
        .eq("doctor_id", ctx.staff.id).neq("status", "resolved").order("due_at").limit(20)
    : { data: [] };
  const escNames = (escs ?? []).length ? await patientNames(ctx, Array.from(new Set((escs ?? []).map((x) => x.patient_id)))) : new Map();
  const ar = locale === "ar";

  return (
    <>
      <PageHeader title={t("nav.doctor")} subtitle={`${t("apt.today")} · ${day}`} />
      <Banner error={searchParams.error} />
      {(escs ?? []).length > 0 && (
        <section className="mb-5 rounded-xl border border-gold-300 bg-gold-50 p-4" data-doctor-escalations>
          <p className="mb-2 text-sm font-medium text-navy-700">{ar ? "متابعات مرضاك من مساعد المتابعة" : "Your patients — from the care assistant"}</p>
          <ul className="space-y-2 text-sm">
            {(escs ?? []).map((x) => (
              <li key={x.id} className={x.severity === "urgent" ? "font-medium text-danger" : ""}>
                <Link href={x.journey_id ? `/os/care/${x.journey_id}` : "/os/care"} className="hover:underline">
                  {escNames.get(x.patient_id)?.name ?? ""} · {pick(x.summary, ar)}{x.patient_text ? ` — «${x.patient_text}»` : ""}</Link>
                <span className="num text-xs text-ink-500"> {x.ref}</span>
              </li>))}
          </ul>
        </section>)}
      <div className="card">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-4">
                  <span className="min-w-[5.5rem] text-lg font-semibold text-navy-700 whitespace-nowrap">{timeOnly(rangeStart(a.slot), locale)}</span>
                  <div>
                    <Link href={`/os/patients/${a.patient_id}`} className="font-medium text-navy-700 hover:underline">{patientName(a.patient, locale)}</Link>
                    <p className="num text-xs text-ink-300">{a.patient?.mrn}{a.queue_no ? ` · #${a.queue_no}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={a.status} label={t(`apt.status.${a.status}` as DictKey)} />
                  <form action={openEncounter}>
                    <input type="hidden" name="appointment_id" value={a.id} />
                    <SubmitButton pendingLabel="…" className="btn-primary !py-1.5">{t("enc.open")}</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
