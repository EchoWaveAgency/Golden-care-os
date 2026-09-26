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

  return (
    <>
      <PageHeader title={t("nav.doctor")} subtitle={`${t("apt.today")} · ${day}`} />
      <Banner error={searchParams.error} />
      <div className="card">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-4">
                  <span className="min-w-[5.5rem] text-lg font-semibold text-navy-700 whitespace-nowrap">{timeOnly(rangeStart(a.slot), locale)}</span>
                  <div>
                    <Link href={`/patients/${a.patient_id}`} className="font-medium text-navy-700 hover:underline">{patientName(a.patient, locale)}</Link>
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
