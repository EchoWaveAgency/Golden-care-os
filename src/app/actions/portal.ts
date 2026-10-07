"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortal, PORTAL_FOR_COOKIE } from "@/lib/portal";
import { portalError } from "@/lib/errors";
import type { Lang } from "@/lib/site/api";

// Every portal action runs as the signed-in patient; the portal_* functions re-check access.
const langOf = (f: FormData): Lang => (f.get("lang") === "en" ? "en" : "ar");
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function back(lang: Lang, page: string, error?: { message: string } | null, ok?: string): never {
  const q = error ? `?error=${encodeURIComponent(portalError(error.message, lang))}` : ok ? `?ok=${encodeURIComponent(ok)}` : "";
  redirect(`/${lang}/portal/${page}${q}`);
}

export async function switchPatient(form: FormData) {
  const lang = langOf(form);
  const { me } = await getPortal(lang);
  const id = str(form, "patient");
  if (me.family.some((f) => f.id === id)) cookies().set(PORTAL_FOR_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 });
  else cookies().delete(PORTAL_FOR_COOKIE);
  redirect(`/${lang}/portal/home`);
}

export async function portalBook(form: FormData) {
  const lang = langOf(form);
  const { supabase, active } = await getPortal(lang);
  const doctor = str(form, "doctor");
  const start = str(form, "start");
  if (!/^[0-9a-f-]{36}$/i.test(doctor) || !start) back(lang, "appointments/book", { message: "no longer available" });
  const { data, error } = await supabase.rpc("portal_book", { p_patient: active.id, p_doctor: doctor, p_start: start, p_note: str(form, "note").slice(0, 500) || null });
  if (error) back(lang, "appointments/book", error);
  back(lang, "appointments", null, String(data));
}

export async function portalCancel(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const { error } = await supabase.rpc("portal_cancel", { p_appointment: str(form, "id"), p_reason: str(form, "reason").slice(0, 300) });
  back(lang, "appointments", error, error ? undefined : "cancelled");
}

export async function portalSurvey(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const score = Number(form.get("score"));
  if (!(score >= 1 && score <= 5)) back(lang, "appointments", { message: "invalid input" });
  const { error } = await supabase.rpc("portal_survey", { p_appointment: str(form, "id"), p_score: score, p_comment: str(form, "comment").slice(0, 1000) || null });
  back(lang, "appointments", error, error ? undefined : "survey");
}

const KINDS = ["inquiry", "complaint", "callback", "reschedule", "refund"];
export async function portalTicket(form: FormData) {
  const lang = langOf(form);
  const { supabase, active } = await getPortal(lang);
  const kind = str(form, "kind");
  const subject = str(form, "subject");
  if (!KINDS.includes(kind) || subject.length < 2) back(lang, "support", { message: "invalid input" });
  const { data, error } = await supabase.rpc("portal_open_ticket", { p_patient: active.id, p_kind: kind, p_subject: subject.slice(0, 200), p_body: str(form, "body").slice(0, 2000) || null });
  back(lang, "support", error, error ? undefined : String(data));
}

export async function portalProfile(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const { error } = await supabase.rpc("portal_update_profile", {
    p_email: str(form, "email"), p_emergency_name: str(form, "emergency_name"), p_emergency_phone: str(form, "emergency_phone"),
    p_whatsapp: form.get("whatsapp") === "on",
  });
  back(lang, "profile", error, error ? undefined : "saved");
}

export async function portalShare(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const level = str(form, "level") === "full" ? "full" : "appointments";
  const { error } = await supabase.rpc("portal_share_access", {
    p_grantee_mrn: str(form, "mrn"), p_grantee_phone: str(form, "phone"), p_level: level, p_relation: str(form, "relation") || "other",
    p_days: Math.min(Math.max(Number(form.get("days") || 365), 1), 730),
  });
  back(lang, "family", error, error ? undefined : "shared");
}

export async function portalRevoke(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const { error } = await supabase.rpc("portal_revoke_access", { p_grant: str(form, "grant") });
  back(lang, "family", error, error ? undefined : "revoked");
}

// Loyalty: the patient creates their own referral code to share.
export async function portalReferralCode(form: FormData) {
  const lang = langOf(form);
  const { supabase, active } = await getPortal(lang);
  const { error } = await supabase.rpc("portal_referral_code", { p_patient: active.id });
  back(lang, "finance", error, "referral");
}

// Treatment plan accepted by the patient (number of monthly installments within what the clinic allowed).
export async function portalAcceptPlan(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const { error } = await supabase.rpc("portal_accept_plan", { p_plan: str(form, "plan"), p_installments: Number(str(form, "installments") || 1) });
  back(lang, "plans", error, "accepted");
}
