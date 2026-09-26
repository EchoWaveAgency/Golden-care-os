"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Doctor opens (or resumes) the encounter for an appointment and moves the patient into consultation. */
export async function openEncounter(form: FormData) {
  const ctx = await getContext();
  const appointmentId = String(form.get("appointment_id"));
  const { data: existing } = await ctx.supabase.from("encounters").select("id").eq("appointment_id", appointmentId).maybeSingle();
  if (existing) redirect(`/os/encounters/${existing.id}`);

  const { data: apt, error: aErr } = await ctx.supabase
    .from("appointments")
    .select("id, branch_id, patient_id, doctor_id, specialty_id, status")
    .eq("id", appointmentId)
    .single();
  if (aErr || !apt) fail("/os/doctor", friendlyError(aErr?.message, ctx.locale));

  if (apt.status === "arrived" || apt.status === "waiting") {
    await ctx.supabase.rpc("transition_appointment", { p_id: apt.id, p_to: "in_consultation", p_reason: null });
  }
  const { data, error } = await ctx.supabase
    .from("encounters")
    .insert({
      branch_id: apt.branch_id, patient_id: apt.patient_id, doctor_id: apt.doctor_id,
      appointment_id: apt.id, specialty_id: apt.specialty_id,
    })
    .select("id")
    .single();
  if (error) fail("/os/doctor", friendlyError(error.message, ctx.locale));
  redirect(`/os/encounters/${data.id}`);
}

export async function saveEncounter(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const path = `/os/encounters/${id}`;
  const { error } = await ctx.supabase
    .from("encounters")
    .update({
      chief_complaint: String(form.get("chief_complaint") ?? "").trim() || null,
      assessment: String(form.get("assessment") ?? "").trim() || null,
      plan: String(form.get("plan") ?? "").trim() || null,
    })
    .eq("id", id);
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  if (form.get("intent") === "sign") {
    const { error: sErr } = await ctx.supabase.rpc("sign_encounter", { p_id: id });
    if (sErr) fail(path, friendlyError(sErr.message, ctx.locale));
  }
  revalidatePath(path);
  redirect(path);
}

export async function addAddendum(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("encounter_id"));
  const body = String(form.get("body") ?? "").trim();
  if (!body) fail(`/os/encounters/${id}`, ctx.locale === "ar" ? "اكتب نص الملاحظة." : "Write the addendum text.");
  const { error } = await ctx.supabase.from("encounter_addenda").insert({ encounter_id: id, body });
  if (error) fail(`/os/encounters/${id}`, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${id}`);
  redirect(`/os/encounters/${id}`);
}

export async function addAlert(form: FormData) {
  const ctx = await getContext();
  const encounterId = String(form.get("encounter_id"));
  const label = String(form.get("label") ?? "").trim();
  if (label.length < 2) fail(`/os/encounters/${encounterId}`, ctx.locale === "ar" ? "اكتب وصف التنبيه." : "Describe the alert.");
  const { error } = await ctx.supabase.from("patient_alerts").insert({
    patient_id: String(form.get("patient_id")),
    kind: String(form.get("kind")),
    severity: String(form.get("severity")),
    label,
  });
  if (error) fail(`/os/encounters/${encounterId}`, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/encounters/${encounterId}`);
  redirect(`/os/encounters/${encounterId}`);
}
