// Renders a template body with named variables. English uses *_en variants when present.
export function renderTemplate(body: string, vars: Record<string, unknown>, lang: "ar" | "en"): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = (lang === "en" ? vars[`${k}_en`] : undefined) ?? vars[k];
    return v == null ? "" : String(v);
  });
}

/** Positional parameter order for Meta-approved templates ({{1}}, {{2}}, …). */
export const TEMPLATE_PARAMS: Record<string, string[]> = {
  appointment_confirmed: ["name", "date", "time", "doctor", "ref"],
  appointment_reminder: ["date", "time", "doctor"],
  appointment_cancelled: ["ref"],
  result_released: ["name"],
  portal_otp: ["code"],
  care_booking_confirm: ["name", "doctor", "date", "time"],
  care_pre_visit: ["name", "date", "time", "doctor"],
  care_post_visit: ["name", "doctor"],
  care_followup: ["name", "doctor", "due"],
  care_nudge: ["name"],
};

/** Egyptian E.164 → WhatsApp "to" (digits only). */
export function waNumber(e164: string): string {
  return e164.replace(/\D/g, "");
}
