"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

export async function updateTicket(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  const { error } = await ctx.supabase.from("support_tickets").update({
    status, resolution: String(form.get("resolution") ?? "").trim() || null,
    assigned_to: status === "in_progress" ? ctx.user.id : undefined,
  }).eq("id", id);
  revalidatePath("/os/tickets");
  redirect(`/os/tickets${error ? `?error=${encodeURIComponent(friendlyError(error.message, ctx.locale))}` : ""}`);
}

export async function retryMessage(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("retry_message", { p_id: String(form.get("id")) });
  revalidatePath("/os/messages");
  redirect(`/os/messages${error ? `?error=${encodeURIComponent(friendlyError(error.message, ctx.locale))}` : ""}`);
}

export async function grantFamily(form: FormData) {
  const ctx = await getContext();
  const patientId = String(form.get("patient_id"));
  const mrn = String(form.get("grantee_mrn") ?? "").trim().toUpperCase();
  const path = `/os/patients/${patientId}`;
  const { data: grantee } = await ctx.supabase.from("patients").select("id").eq("mrn", mrn).maybeSingle();
  if (!grantee) redirect(`${path}?error=${encodeURIComponent(ctx.locale === "ar" ? "لا يوجد ملف بهذا الرقم." : "No file with that MRN.")}`);
  const days = Number(form.get("days") || 365);
  const { error } = await ctx.supabase.rpc("staff_grant_family", {
    p_patient: patientId, p_grantee: grantee.id, p_level: String(form.get("level")), p_relation: String(form.get("relation")),
    p_expires: new Date(Date.now() + days * 86400000).toISOString(), p_evidence: String(form.get("evidence") ?? ""),
  });
  revalidatePath(path);
  redirect(`${path}${error ? `?error=${encodeURIComponent(friendlyError(error.message, ctx.locale))}` : ""}`);
}

export async function revokeFamily(form: FormData) {
  const ctx = await getContext();
  const path = `/os/patients/${form.get("patient_id")}`;
  const { error } = await ctx.supabase.rpc("staff_revoke_family", { p_grant: String(form.get("grant_id")) });
  revalidatePath(path);
  redirect(`${path}${error ? `?error=${encodeURIComponent(friendlyError(error.message, ctx.locale))}` : ""}`);
}
