import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireAny } from "@/lib/session";
import { clinicToday } from "@/lib/format";
import { patientName } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { BookingForm } from "./BookingForm";

export const metadata = { title: "Book appointment" };
export const dynamic = "force-dynamic";

export default async function NewAppointmentPage({ searchParams }: { searchParams: { patient?: string } }) {
  const ctx = await requireAny("appointment.write");
  const { t, locale } = ctx;
  const ar = locale === "ar";

  if (!searchParams.patient) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={t("apt.new")} />
        <div className="card p-6 text-sm text-ink-500">
          {ar ? "ابحث عن المريض أولًا ثم اضغط «حجز موعد» من ملفه." : "Find the patient first, then choose “Book appointment” from their file."}
          <div className="mt-4 flex gap-2">
            <Link href="/os/patients" className="btn-primary">{t("nav.patients")}</Link>
            <Link href="/os/patients/new" className="btn-ghost">{t("patient.new")}</Link>
          </div>
        </div>
      </div>
    );
  }

  const [{ data: patient }, { data: doctors }, { data: devices }] = await Promise.all([
    ctx.supabase.from("patients").select("id, mrn, first_name_ar, last_name_ar, first_name_en, last_name_en").eq("id", searchParams.patient).maybeSingle(),
    ctx.supabase.from("staff").select("id, full_name_ar, full_name_en, specialty:specialties(name_ar, name_en)")
      .eq("kind", "doctor").eq("is_active", true).eq("branch_id", ctx.branchId!).order("full_name_ar")
      .returns<{ id: string; full_name_ar: string; full_name_en: string | null; specialty: { name_ar: string; name_en: string } | null }[]>(),
    ctx.supabase.from("devices").select("id, name_ar, name_en, asset_no").eq("branch_id", ctx.branchId!).eq("status", "active").in("category", ["laser", "ipl", "rf", "energy_other", "imaging"]).order("asset_no"),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t("apt.new")} subtitle={patient ? `${patientName(patient, locale)} · ${patient.mrn}` : undefined} />
      <BookingForm
        patientId={searchParams.patient}
        today={clinicToday()}
        idempotencyKey={randomUUID()}
        devices={(devices ?? []).map((d) => ({ id: d.id, name: `${ar ? d.name_ar : d.name_en} · ${d.asset_no}` }))}
        doctors={(doctors ?? []).map((d) => ({
          id: d.id,
          name: ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar,
          specialty: (ar ? d.specialty?.name_ar : d.specialty?.name_en) ?? "",
        }))}
        l={{
          doctor: t("apt.doctor"), date: t("common.date"), time: t("common.time"), duration: t("apt.duration"),
          channel: t("apt.channel"), notes: t("common.notes"), device: ar ? "الجهاز (لجلسات الليزر والأجهزة)" : "Device (laser / device sessions)", submit: t("apt.new"), loading: t("common.loading"),
          ch_front_desk: ar ? "الاستقبال" : "Front desk", ch_phone: ar ? "مكالمة" : "Phone call",
          ch_walk_in: ar ? "حضور مباشر" : "Walk-in", ch_social: ar ? "سوشيال ميديا" : "Social media",
          ch_referral: ar ? "إحالة" : "Referral",
        }}
      />
    </div>
  );
}
