"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}
const STATUSES = ["contacted", "qualified", "follow_up_completed", "closed"];

export async function setLeadStatus(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  const path = `/os/leads/${id}`;
  if (!STATUSES.includes(status)) fail(path, friendlyError(null, ctx.locale));
  const { error } = await ctx.supabase.from("leads").update({
    status, close_reason: status === "closed" ? String(form.get("reason") ?? "").trim() || null : undefined,
  }).eq("id", id);
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  revalidatePath(path);
  redirect(path);
}

export async function addLeadActivity(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const body = String(form.get("body") ?? "").trim();
  const kind = ["note", "call", "whatsapp"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "note";
  const path = `/os/leads/${id}`;
  if (!body) fail(path, ctx.locale === "ar" ? "اكتب الملاحظة." : "Write the note.");
  const { error } = await ctx.supabase.from("lead_activities").insert({ lead_id: id, kind, body });
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  revalidatePath(path);
  redirect(path);
}

export async function assignLeadToMe(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const { error } = await ctx.supabase.from("leads").update({ assigned_to: ctx.user.id }).eq("id", id);
  if (error) fail(`/os/leads/${id}`, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/leads/${id}`);
  redirect(`/os/leads/${id}`);
}

/** Find or create the patient, book the chosen real slot, and link everything to the lead. */
export async function convertLead(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const path = `/os/leads/${id}`;
  const slot = String(form.get("slot") ?? "");
  const doctorId = String(form.get("doctor_id") ?? "");
  const m = slot.match(/^(.+)\|(.+)$/);
  if (!m || !doctorId) fail(path, ctx.locale === "ar" ? "اختر الطبيب والموعد." : "Choose a doctor and a time.");

  const { data: lead } = await ctx.supabase.from("leads").select("*").eq("id", id).single();
  if (!lead) fail(path, friendlyError(null, ctx.locale));

  let patientId: string | null = lead.patient_id;
  if (!patientId) {
    const { data: dups } = await ctx.supabase.rpc("find_patient_duplicates", { p_phone: lead.phone });
    patientId = (dups ?? []).find((d: { match_reason: string }) => d.match_reason === "phone")?.patient_id ?? null;
  }
  if (!patientId) {
    const parts = String(lead.full_name).trim().split(/\s+/);
    const first = parts.shift() ?? lead.full_name;
    const { data: p, error: pErr } = await ctx.supabase.from("patients")
      .insert({ branch_id: lead.branch_id, first_name_ar: first, last_name_ar: parts.join(" ") || "-", phone_raw: lead.phone,
                email: lead.email, referral_source: lead.utm_source ?? lead.channel })
      .select("id").single();
    if (pErr) fail(path, friendlyError(pErr.message, ctx.locale));
    patientId = p.id;
  }

  const { data: doctor } = await ctx.supabase.from("staff").select("branch_id, specialty_id").eq("id", doctorId).single();
  const { data: apt, error: aErr } = await ctx.supabase.from("appointments").insert({
    branch_id: doctor?.branch_id ?? lead.branch_id, patient_id: patientId, doctor_id: doctorId,
    specialty_id: doctor?.specialty_id ?? lead.specialty_id, slot: `[${m[1]},${m[2]})`,
    channel: lead.channel, status: "booked", idempotency_key: `lead-${id}-${m[1]}`,
  }).select("id").single();
  if (aErr) fail(path, friendlyError(aErr.message, ctx.locale));

  const { error: lErr } = await ctx.supabase.rpc("lead_link_appointment", { p_lead: id, p_patient: patientId, p_appointment: apt.id });
  if (lErr) fail(path, friendlyError(lErr.message, ctx.locale));
  revalidatePath(path);
  redirect(`${path}?converted=1`);
}
