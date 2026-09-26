import { notFound } from "next/navigation";
import { getContext } from "@/lib/session";
import { RxSheet } from "@/components/RxSheet";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PrintRx({ params }: { params: { id: string } }) {
  const ctx = await getContext();
  const { data: r } = await ctx.supabase.from("prescriptions")
    .select("ref, status, signed_at, notes_for_patient, patient_id, doctor:staff(full_name_ar, full_name_en, specialty:specialties(name_ar, name_en)), items:prescription_items(drug_name, strength, form, dose, frequency, duration, instructions, sort_order)")
    .eq("id", params.id).maybeSingle();
  if (!r || r.status !== "signed") notFound();
  const { data: dir } = await ctx.supabase.rpc("patient_directory", { p_ids: [r.patient_id] });
  const p = ((dir ?? []) as { mrn: string; full_name_ar: string }[])[0];
  const { data: allergies } = await ctx.supabase.from("patient_alerts").select("label").eq("patient_id", r.patient_id).eq("kind", "allergy").eq("is_active", true);
  const doc = r.doctor as unknown as { full_name_ar: string; full_name_en: string | null; specialty: { name_ar: string; name_en: string } };
  const ar = ctx.locale === "ar";
  return (
    <div className="min-h-screen bg-ivory-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-2xl justify-end"><PrintButton label={ctx.t("common.print")} /></div>
      <RxSheet lang={ctx.locale} rxRef={r.ref} date={r.signed_at} patientName={p?.full_name_ar ?? ""} mrn={p?.mrn ?? ""}
        doctorName={ar ? doc.full_name_ar : doc.full_name_en ?? doc.full_name_ar} specialty={ar ? doc.specialty.name_ar : doc.specialty.name_en}
        notes={r.notes_for_patient} allergies={(allergies ?? []).map((a) => a.label)}
        items={((r.items ?? []) as { drug_name: string; strength: string | null; form: string | null; dose: string; frequency: string; duration: string | null; instructions: string | null; sort_order: number }[])
          .sort((a, b) => a.sort_order - b.sort_order).map((i) => ({ drug: i.drug_name, strength: i.strength, form: i.form, dose: i.dose, frequency: i.frequency, duration: i.duration, instructions: i.instructions }))} />
    </div>
  );
}
