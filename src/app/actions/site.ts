"use server";
import { headers } from "next/headers";
import { anonClient } from "@/lib/site/api";
import { copy, isLang } from "@/lib/site/copy";

export type InquiryState = { ok?: boolean; ref?: string; error?: string } | undefined;

const field = (f: FormData, k: string, max = 300) => String(f.get(k) ?? "").trim().slice(0, max);

// Public form endpoint. Validation is repeated in the database; this adds bot protection
// (honeypot + minimum fill time) and never returns internal identifiers.
export async function submitInquiry(_prev: InquiryState, form: FormData): Promise<InquiryState> {
  const lang = isLang(field(form, "lang")) ? (field(form, "lang") as "ar" | "en") : "ar";
  const c = copy(lang);
  if (field(form, "website")) return { ok: true, ref: "—" };                       // honeypot: pretend success
  const started = Number(form.get("started_at") ?? 0);
  if (started && Date.now() - started < 2500) return { error: c.errors.generic };    // filled too fast → bot
  if (field(form, "full_name").length < 2) return { error: c.errors.name };
  if (form.get("consent_contact") !== "on") return { error: c.errors.consent };

  const referer = headers().get("referer") ?? "";
  const payload = {
    kind: ["booking", "callback", "inquiry"].includes(field(form, "kind")) ? field(form, "kind") : "inquiry",
    full_name: field(form, "full_name", 120),
    phone: field(form, "phone", 30),
    email: field(form, "email", 120),
    message: field(form, "message", 1000),
    specialty_slug: field(form, "specialty_slug", 80) || null,
    doctor_slug: field(form, "doctor_slug", 80) || null,
    offer_slug: field(form, "offer_slug", 80) || null,
    landing_slug: field(form, "landing_slug", 80) || null,
    preferred_start: field(form, "preferred_start", 40) || null,
    consent_contact: true,
    consent_marketing: form.get("consent_marketing") === "on",
    consent_version: "web-2026-09",
    utm_source: field(form, "utm_source", 100) || null,
    utm_medium: field(form, "utm_medium", 100) || null,
    utm_campaign: field(form, "utm_campaign", 150) || null,
    utm_content: field(form, "utm_content", 150) || null,
    utm_term: field(form, "utm_term", 150) || null,
    page_path: field(form, "page_path", 300) || (() => { try { return new URL(referer).pathname; } catch { return null; } })(),
    lang,
  };
  const { data, error } = await anonClient().rpc("submit_web_inquiry", { p: payload });
  if (error) {
    const m = error.message;
    if (/invalid phone/.test(m)) return { error: c.errors.phone };
    if (/consent/.test(m)) return { error: c.errors.consent };
    if (/no longer available/.test(m)) return { error: c.errors.slot };
    if (/too many requests/.test(m)) return { error: c.errors.rate };
    if (/name is required/.test(m)) return { error: c.errors.name };
    return { error: c.errors.generic };
  }
  return { ok: true, ref: String(data) };
}
