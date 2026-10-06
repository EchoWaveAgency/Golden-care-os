"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { sendText } from "@/lib/messaging/provider";
import { careSimulatorOn } from "@/lib/care/voice";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const bool = (form: FormData, k: string) => form.get(k) === "on";

export async function saveCareSettings(form: FormData) {
  const ctx = await getContext();
  const p: Record<string, unknown> = {
    enabled: bool(form, "enabled"), booking_confirm: bool(form, "booking_confirm"), pre_visit: bool(form, "pre_visit"),
    post_visit: bool(form, "post_visit"), followup: bool(form, "followup"), voice_enabled: bool(form, "voice_enabled"), voice_fallback: bool(form, "voice_fallback"),
    contact_from: s(form, "contact_from"), contact_to: s(form, "contact_to"), confirm_delay_min: s(form, "confirm_delay_min"),
    confirm_min_lead_hours: s(form, "confirm_min_lead_hours"), post_visit_delay_hours: s(form, "post_visit_delay_hours"),
    followup_lead_days: s(form, "followup_lead_days"), nudge_after_hours: s(form, "nudge_after_hours"), max_nudges: s(form, "max_nudges"),
    clinic_phone: s(form, "clinic_phone"),
  };
  const { error } = await ctx.supabase.rpc("save_care_settings", { p_branch: ctx.branchId, p });
  go("/os/care/settings", error, ctx.locale, "saved");
}

export async function setFollowup(form: FormData) {
  const ctx = await getContext();
  const enc = s(form, "encounter_id");
  const { error } = await ctx.supabase.rpc("set_care_followup", { p_encounter: enc, p_due_on: s(form, "due_on") || null, p_note: s(form, "note") || null });
  go(`/os/encounters/${enc}`, error, ctx.locale, "followup_set");
}

export async function cancelFollowup(form: FormData) {
  const ctx = await getContext();
  const enc = s(form, "encounter_id");
  const { error } = await ctx.supabase.rpc("cancel_care_followup", { p_encounter: enc, p_reason: s(form, "reason") });
  go(`/os/encounters/${enc}`, error, ctx.locale, "followup_cancelled");
}

async function journeyStep(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const ctx = await getContext();
  const id = s(form, "journey_id");
  const { error } = await ctx.supabase.rpc(fn, { p_journey: id, ...args });
  go(`/os/care/${id}`, error, ctx.locale, ok);
}
export async function takeOver(form: FormData) { await journeyStep(form, "care_take_over", {}, "taken"); }
export async function resumeAgent(form: FormData) { await journeyStep(form, "care_resume", {}, "resumed"); }
export async function closeJourney(form: FormData) { await journeyStep(form, "care_close", { p_note: s(form, "note") }, "closed"); }

/** A staff reply on WhatsApp: recorded first (permission and 24-hour window checked by the database), then sent. */
export async function staffReply(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "journey_id");
  const { data, error } = await ctx.supabase.rpc("care_staff_message", { p_journey: id, p_body: s(form, "body") });
  if (error) go(`/os/care/${id}`, error, ctx.locale);
  const m = data as { id: string; phone: string };
  const r = await sendText(m.phone, s(form, "body"));
  await ctx.supabase.rpc("care_message_result", { p_id: m.id, p_ok: r.ok, p_provider: r.provider, p_provider_id: r.id ?? null, p_error: r.error ?? null });
  go(`/os/care/${id}`, r.ok ? null : { message: r.error ?? "send failed" }, ctx.locale, "sent");
}

export async function updateEscalation(form: FormData) {
  const ctx = await getContext();
  const back = s(form, "back") || "/os/care";
  const { error } = await ctx.supabase.rpc("care_escalation_update", { p_id: s(form, "id"), p_action: s(form, "action"), p_note: s(form, "note") || null });
  go(back, error, ctx.locale, s(form, "action") === "resolve" ? "resolved" : "acknowledged");
}

// ---------- Local simulator (development messaging mode only; never with a real provider)
async function simulatorGuard() {
  const ctx = await getContext();
  if (!careSimulatorOn() || !ctx.can("care.manage")) redirect("/os/care?error=" + encodeURIComponent(ctx.locale === "ar" ? "المحاكي غير متاح." : "Simulator not available."));
  return ctx;
}

export async function simulateDue() {
  const ctx = await simulatorGuard();
  const { processDue } = await import("@/lib/care/runner");
  const r = await processDue(50);
  go("/os/care", null, ctx.locale, `run_${(r as { opened?: number }).opened ?? 0}`);
}

export async function simulateReply(form: FormData) {
  const ctx = await simulatorGuard();
  const id = s(form, "journey_id");
  const { data: j } = await ctx.supabase.from("care_journeys").select("id, channel, state, to_phone").eq("id", id).single();
  const runner = await import("@/lib/care/runner");
  if (j?.channel === "voice") {
    if (j.state === "dialing") await runner.voiceOpen(id);
    else await runner.voiceTurn(id, s(form, "text"));
  } else if (j) {
    await runner.processInbound({ phone: j.to_phone, text: s(form, "text"), providerId: `sim-${crypto.randomUUID()}` });
  }
  go(`/os/care/${id}`, null, ctx.locale);
}
