import "server-only";
import { randomUUID } from "node:crypto";
import { TEMPLATE_PARAMS, waNumber } from "./render";

export type SendInput = { to: string; template: string; providerTemplate: string | null; lang: "ar" | "en"; vars: Record<string, unknown>; body: string };
export type SendResult = { ok: boolean; provider: string; id?: string; error?: string };

export function messagingMode(): "whatsapp" | "dev" | "disabled" {
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return "whatsapp";
  if (process.env.MESSAGING_MODE === "dev") return "dev";
  return "disabled";
}

// WhatsApp Business Cloud API adapter (template messages; business-initiated).
async function sendWhatsApp(m: SendInput): Promise<SendResult> {
  const params = (TEMPLATE_PARAMS[m.template] ?? []).map((k) => {
    const v = (m.lang === "en" ? m.vars[`${k}_en`] : undefined) ?? m.vars[k];
    return { type: "text", text: v == null ? "-" : String(v) };
  });
  const payload = {
    messaging_product: "whatsapp",
    to: waNumber(m.to),
    type: "template",
    template: {
      name: m.providerTemplate ?? `gc_${m.template}`,
      language: { code: m.lang === "en" ? "en" : "ar" },
      components: params.length ? [{ type: "body", parameters: params }] : [],
    },
  };
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { ok: false, provider: "whatsapp", error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, provider: "whatsapp", id: json.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, provider: "whatsapp", error: e instanceof Error ? e.message : "network error" };
  }
}

/** Free-text reply inside WhatsApp's 24-hour customer-service window (the patient wrote to us first). */
export async function sendText(to: string, body: string): Promise<SendResult> {
  const mode = messagingMode();
  if (mode === "dev") {
    console.info(`[messaging:dev] to=${to} text :: ${body}`);
    return { ok: true, provider: "dev", id: `dev-${randomUUID()}` };
  }
  if (mode !== "whatsapp") return { ok: false, provider: "none", error: "no messaging provider configured" };
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: waNumber(to), type: "text", text: { preview_url: false, body } }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) return { ok: false, provider: "whatsapp", error: json.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, provider: "whatsapp", id: json.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, provider: "whatsapp", error: e instanceof Error ? e.message : "network error" };
  }
}

export async function sendMessage(m: SendInput): Promise<SendResult> {
  const mode = messagingMode();
  if (mode === "whatsapp") return sendWhatsApp(m);
  if (mode === "dev") {
    // Development only: prints the message instead of sending it. Never enable in production.
    console.info(`[messaging:dev] to=${m.to} template=${m.template} :: ${m.template === "portal_otp" ? "(code hidden)" : m.body}`);
    return { ok: true, provider: "dev", id: `dev-${randomUUID()}` };
  }
  return { ok: false, provider: "none", error: "no messaging provider configured" };
}

// ---------- SMS (for patients who prefer SMS, and the optional WhatsApp fallback)
export function smsMode(): "twilio" | "dev" | "disabled" {
  if (process.env.SMS_PROVIDER === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM) return "twilio";
  if (process.env.MESSAGING_MODE === "dev") return "dev";
  return "disabled";
}

export async function sendSms(to: string, body: string, template: string): Promise<SendResult> {
  const mode = smsMode();
  if (mode === "dev") {
    console.info(`[sms:dev] to=${to} template=${template} :: ${template === "portal_otp" ? "(code hidden)" : body}`);
    return { ok: true, provider: "sms-dev", id: `sms-dev-${randomUUID()}` };
  }
  if (mode !== "twilio") return { ok: false, provider: "none", error: "no SMS provider configured" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_SMS_FROM!, Body: body.slice(0, 1500) }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, provider: "twilio-sms", error: json.message ?? `HTTP ${res.status}` };
    return { ok: true, provider: "twilio-sms", id: json.sid };
  } catch (e) {
    return { ok: false, provider: "twilio-sms", error: e instanceof Error ? e.message : "network error" };
  }
}

