"use server";
import { cookies, headers } from "next/headers";
import { PORTAL_FOR_COOKIE } from "@/lib/portal";
import { toWesternDigits } from "@/lib/format";
import { redirect } from "next/navigation";
import { adminClient } from "@/lib/server/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { sendMessage } from "@/lib/messaging/provider";
import { renderTemplate } from "@/lib/messaging/render";

export type OtpState = { step: "phone" | "code"; phone?: string; error?: string; info?: string; devCode?: string } | undefined;

const T = {
  ar: { sent: "إذا كان الرقم مسجلًا لدينا فسيصلك رمز الدخول عبر واتساب خلال لحظات.", invalid: "الرمز غير صحيح أو انتهت صلاحيته.", many: "محاولات كثيرة. حاول بعد قليل.", phone: "اكتب رقم الموبايل المسجل.", unavailable: "تسجيل الدخول غير متاح حاليًا." },
  en: { sent: "If this number is registered with us, a sign-in code will arrive on WhatsApp shortly.", invalid: "The code is incorrect or has expired.", many: "Too many attempts. Please try again later.", phone: "Enter your registered mobile number.", unavailable: "Sign-in is not available right now." },
};

// Step 1: issue a one-time code. The response is identical whether or not the number exists.
export async function requestOtp(_prev: OtpState, form: FormData): Promise<OtpState> {
  const lang = form.get("lang") === "en" ? "en" : "ar";
  const phone = String(form.get("phone") ?? "").trim();
  if (phone.length < 8) return { step: "phone", error: T[lang].phone };
  const ip = (headers().get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  let db;
  try { db = adminClient(); } catch { return { step: "phone", error: T[lang].unavailable }; }
  const { data, error } = await db.rpc("svc_portal_otp_issue", { p_phone: phone, p_ip: ip });
  if (error) return { step: "phone", error: /too many/.test(error.message) ? T[lang].many : T[lang].unavailable };
  const row = (data ?? [])[0] as { code: string; patient_id: string } | undefined;
  let devCode: string | undefined;
  if (row) {
    const { data: tpl } = await db.from("message_templates").select("body, provider_template").eq("code", "portal_otp").eq("lang", lang).maybeSingle();
    const { data: p } = await db.from("patients").select("phone").eq("id", row.patient_id).single();
    const r = await sendMessage({ to: p?.phone ?? "", template: "portal_otp", providerTemplate: tpl?.provider_template ?? null, lang,
                                  vars: { code: row.code }, body: renderTemplate(tpl?.body ?? "{{code}}", { code: row.code }, lang) });
    await db.rpc("svc_log_otp_message", { p_patient: row.patient_id, p_ok: r.ok, p_provider: r.provider, p_provider_id: r.id ?? null, p_error: r.error ?? null });
    // Local development only (explicit flag); never set PORTAL_DEV_SHOW_OTP in production.
    if (process.env.PORTAL_DEV_SHOW_OTP === "true") devCode = row.code;
  }
  return { step: "code", phone, info: T[lang].sent, devCode };
}

// Step 2: verify the code, then create a normal Supabase session for the patient account.
export async function verifyOtp(_prev: OtpState, form: FormData): Promise<OtpState> {
  const lang = form.get("lang") === "en" ? "en" : "ar";
  const phone = String(form.get("phone") ?? "");
  const code = toWesternDigits(String(form.get("code") ?? "")).replace(/\D/g, "");
  const db = adminClient();
  const { data: patientId, error } = await db.rpc("svc_portal_otp_verify", { p_phone: phone, p_code: code });
  if (error || !patientId) return { step: "code", phone, error: T[lang].invalid };

  const email = `p-${patientId}@portal.goldencare.local`;       // internal identity, never shown or emailed
  const created = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { kind: "patient" } });
  if (created.error && !/already|registered|exists/i.test(created.error.message)) return { step: "code", phone, error: T[lang].unavailable };
  const link = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error || !link.data.properties?.hashed_token) return { step: "code", phone, error: T[lang].unavailable };

  const supabase = supabaseServer();
  const { data: session, error: vErr } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (vErr || !session.user) return { step: "code", phone, error: T[lang].unavailable };
  await db.rpc("svc_portal_link_account", { p_user: session.user.id, p_patient: patientId });
  cookies().delete(PORTAL_FOR_COOKIE);
  redirect(`/${lang}/portal/home`);
}

export async function portalSignOut(form: FormData) {
  const lang = form.get("lang") === "en" ? "en" : "ar";
  await supabaseServer().auth.signOut();
  cookies().delete(PORTAL_FOR_COOKIE);
  redirect(`/${lang}/portal`);
}
