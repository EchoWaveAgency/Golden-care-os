"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function back(enc: string, msg?: string): never {
  redirect(`/os/encounters/${enc}${msg ? `?error=${encodeURIComponent(msg)}` : ""}`);
}

export async function createPrescription(form: FormData) {
  const ctx = await getContext();
  const enc = String(form.get("encounter_id"));
  const { data: e } = await ctx.supabase.from("encounters").select("branch_id, patient_id, doctor_id").eq("id", enc).single();
  if (!e) back(enc, friendlyError(null, ctx.locale));
  const { error } = await ctx.supabase.from("prescriptions").insert({ encounter_id: enc, branch_id: e.branch_id, patient_id: e.patient_id, doctor_id: e.doctor_id });
  if (error) back(enc, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${enc}`);
  back(enc);
}

export async function addPrescriptionItem(form: FormData) {
  const ctx = await getContext();
  const enc = String(form.get("encounter_id"));
  const drugText = String(form.get("drug") ?? "").trim();
  // The datalist value is "Trade name — strength form[ ⚠]". Match the exact catalogue entry when possible.
  const [namePart, detailPart = ""] = drugText.split(" — ");
  const detail = detailPart.replace("⚠", "").trim();
  const { data: matches } = namePart
    ? await ctx.supabase.from("drugs").select("id, trade_name, strength, form").eq("is_active", true).ilike("trade_name", namePart.trim()).limit(20)
    : { data: [] };
  const drug = (matches ?? []).find((d) => [d.strength, d.form].filter(Boolean).join(" ") === detail) ?? (matches ?? [])[0] ?? null;
  const row = {
    prescription_id: String(form.get("prescription_id")),
    drug_id: drug?.id ?? null,
    drug_name: drug?.trade_name ?? (namePart.trim() || "-"),
    strength: drug?.strength ?? null,
    form: drug?.form ?? null,
    dose: String(form.get("dose") ?? "").trim(),
    frequency: String(form.get("frequency") ?? "").trim(),
    duration: String(form.get("duration") ?? "").trim() || null,
    instructions: String(form.get("instructions") ?? "").trim() || null,
  };
  if (!drugText || !row.dose || !row.frequency) back(enc, ctx.locale === "ar" ? "اكتب اسم الدواء والجرعة وعدد المرات." : "Enter the medicine, dose and frequency.");
  const { error } = await ctx.supabase.from("prescription_items").insert(row);
  if (error) back(enc, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${enc}`);
  back(enc);
}

export async function removePrescriptionItem(form: FormData) {
  const ctx = await getContext();
  const enc = String(form.get("encounter_id"));
  const { error } = await ctx.supabase.from("prescription_items").delete().eq("id", String(form.get("item_id")));
  if (error) back(enc, friendlyError(error.message, ctx.locale));
  back(enc);
}

export async function signPrescription(form: FormData) {
  const ctx = await getContext();
  const enc = String(form.get("encounter_id"));
  const { error } = await ctx.supabase.rpc("sign_prescription", { p_id: String(form.get("prescription_id")), p_ack_allergies: form.get("ack") === "on" });
  if (error) back(enc, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${enc}`);
  back(enc);
}

export async function releaseToPatient(form: FormData) {
  const ctx = await getContext();
  const enc = String(form.get("encounter_id"));
  const kind = String(form.get("kind"));
  const { error } = await ctx.supabase.rpc("release_to_patient", {
    p_kind: kind, p_id: String(form.get("id")),
    p_summary: String(form.get("summary") ?? "").trim() || null, p_instructions: String(form.get("instructions") ?? "").trim() || null,
  });
  if (error) back(enc, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${enc}`);
  back(enc);
}
