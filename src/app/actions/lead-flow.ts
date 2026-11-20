"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { clinicLocalToIso } from "@/lib/format";
import { sendText } from "@/lib/messaging/provider";
import { CC_STATUSES, normalizeCode, splitList, SOURCES } from "@/lib/leads-flow";

// Call-center actions. Everything runs under the signed-in user's session: the database checks the permission
// (owner agent / lead.write / lead.assign) inside each RPC. No service-role key here.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function back(f: FormData, fallback: string) {
  const b = str(f, "back");
  return b.startsWith("/os/") && !b.startsWith("//") ? b.split("?")[0] : fallback;
}
function go(path: string, params: Record<string, string>): never {
  const q = new URLSearchParams(params).toString();
  redirect(q ? `${path}?${q}` : path);
}
function when(f: FormData, prefix: string): string | null {
  const d = str(f, `${prefix}_date`), t = str(f, `${prefix}_time`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(t)) return null;
  return clinicLocalToIso(d, t);
}
function done() { revalidatePath("/os/calls"); revalidatePath("/os/campaigns"); }

export async function setLeadOutcome(form: FormData) {
  const ctx = await getContext();
  const id = str(form, "id");
  const status = str(form, "status");
  const path = back(form, `/os/calls/${id}`);
  if (!(CC_STATUSES as readonly string[]).includes(status) || status === "new") go(path, { error: friendlyError(null, ctx.locale) });
  const at = status === "follow_up" ? when(form, "fu") : status === "booked" ? when(form, "bk") : null;
  const { error } = await ctx.supabase.rpc("lead_set_outcome", {
    p_lead: id, p_status: status,
    p: { at, reason: str(form, "reason") || null, notes: str(form, "notes") || null, service: str(form, "service") || null },
  });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale), open: status });
  done(); revalidatePath(`/os/calls/${id}`);
  go(path, { ok: status });
}

export async function addLeadNote(form: FormData) {
  const ctx = await getContext();
  const id = str(form, "id");
  const path = back(form, `/os/calls/${id}`);
  const { error } = await ctx.supabase.rpc("lead_add_note", { p_lead: id, p_body: str(form, "body") });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(`/os/calls/${id}`);
  go(path, { ok: "note" });
}

export async function assignLead(form: FormData) {
  const ctx = await getContext();
  const id = str(form, "id");
  const user = str(form, "user");
  const path = back(form, `/os/calls/${id}`);
  const { error } = await ctx.supabase.rpc("lead_assign", { p_lead: id, p_user: user === "me" ? ctx.user.id : user || null });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(`/os/calls/${id}`);
  go(path, { ok: "assigned" });
}

export async function archiveLead(form: FormData) {
  const ctx = await getContext();
  const id = str(form, "id");
  const path = `/os/calls/${id}`;
  const { error } = await ctx.supabase.rpc("lead_archive", { p_lead: id, p_reason: str(form, "reason") });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done();
  go(path, { ok: "archived" });
}

export async function setDuty(form: FormData) {
  const ctx = await getContext();
  const path = back(form, "/os/calls");
  const user = str(form, "user");
  const { error } = await ctx.supabase.rpc("lead_set_duty", { p_on: str(form, "on") === "1", p_user: user || null });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done();
  go(path, {});
}

export async function createManualLead(form: FormData) {
  const ctx = await getContext();
  const path = back(form, "/os/calls");
  const source = str(form, "source");
  const { data, error } = await ctx.supabase.rpc("lead_create_manual", { p: {
    full_name: str(form, "full_name"), phone: str(form, "phone"), campaign_code: normalizeCode(str(form, "campaign_code")) || null,
    source: (SOURCES as readonly string[]).includes(source) ? source : "manual", message: str(form, "message") || null,
  } });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done();
  const { data: lead } = await ctx.supabase.from("leads").select("id").eq("code", data as string).maybeSingle();
  if (lead) go(`/os/calls/${lead.id}`, { ok: "created" });
  go(path, { ok: "created" });
}

/** WhatsApp reply from the lead workspace: logged (first contact) → sent → result recorded. */
export async function sendLeadReply(form: FormData) {
  const ctx = await getContext();
  const id = str(form, "id");
  const path = `/os/calls/${id}`;
  const body = str(form, "body");
  const { data, error } = await ctx.supabase.rpc("lead_log_reply", { p_lead: id, p_body: body });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  const logged = data as { id: number; phone: string };
  const r = await sendText(logged.phone, body);
  await ctx.supabase.rpc("lead_reply_result", { p_id: logged.id, p_ok: r.ok, p_provider_id: r.id ?? null, p_error: r.error ?? null });
  done(); revalidatePath(path);
  if (!r.ok) go(path, { error: ctx.locale === "ar" ? `لم تُرسل الرسالة: ${r.error ?? ""}` : `Message not sent: ${r.error ?? ""}` });
  go(path, { ok: "sent" });
}

// ---------------------------------------------------------------- Admin: campaigns and settings

export async function saveCampaign(form: FormData) {
  const ctx = await getContext();
  const path = "/os/campaigns/settings";
  const id = str(form, "id");
  const row = {
    code: normalizeCode(str(form, "code")), name_ar: str(form, "name_ar"), name_en: str(form, "name_en"),
    service_label: str(form, "service_label") || null,
    keywords: splitList(str(form, "keywords")), meta_ad_ids: splitList(str(form, "meta_ad_ids")),
    starts_on: str(form, "starts_on") || null, ends_on: str(form, "ends_on") || null,
    is_active: form.get("is_active") === "on",
    always_on: form.get("always_on") === "on",
    growth_department: str(form, "growth_department") || null,
  };
  const { error } = id
    ? await ctx.supabase.from("lead_campaigns").update(row).eq("id", id)
    : await ctx.supabase.from("lead_campaigns").insert(row);
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(path);
  go(path, { ok: "campaign" });
}

export async function saveLeadSettings(form: FormData) {
  const ctx = await getContext();
  const path = "/os/campaigns/settings";
  const { error } = await ctx.supabase.rpc("lead_update_settings", { p: {
    code_prefix: normalizeCode(str(form, "code_prefix")).replace(/-/g, ""), sla_minutes: str(form, "sla_minutes"),
    auto_assign: form.get("auto_assign") === "on",
  } });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(path);
  go(path, { ok: "settings" });
}

// Growth plan targets and funnel assumptions (lead.campaigns, checked in the database). Rates are entered as percentages.
const rate = (f: FormData, k: string) => { const v = Number(str(f, k)); return Number.isFinite(v) && str(f, k) !== "" ? Math.round(v * 10) / 1000 : null; };

export async function saveGrowthSettings(form: FormData) {
  const ctx = await getContext();
  const path = "/os/campaigns/settings";
  const start = str(form, "phase1_start");
  const { error } = await ctx.supabase.rpc("growth_update_settings", { p: {
    phase1_start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : "",
    phase_weeks: str(form, "phase_weeks") || null,
    booking_rate: rate(form, "booking_rate"), show_rate: rate(form, "show_rate"), new_lead_share: rate(form, "new_lead_share"),
  } });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(path);
  go(path, { ok: "growth" });
}

export async function saveGrowthDepartment(form: FormData) {
  const ctx = await getContext();
  const path = "/os/campaigns/settings";
  const int = (k: string) => (/^\d{1,6}$/.test(str(form, k)) ? str(form, k) : null);
  const { error } = await ctx.supabase.rpc("growth_update_department", { p_code: str(form, "code"), p: {
    baseline_month: int("baseline_month"), target_p1: int("target_p1"), target_p2: int("target_p2"), target_p3: int("target_p3"),
  } });
  if (error) go(path, { error: friendlyError(error.message, ctx.locale) });
  done(); revalidatePath(path);
  go(path, { ok: "growth" });
}
