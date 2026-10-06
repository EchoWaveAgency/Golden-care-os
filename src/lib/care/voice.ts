import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { messagingMode } from "@/lib/messaging/provider";

// Voice calls. Provider-neutral: the conversation logic is the same as WhatsApp, turn by turn.
// - "twilio": Twilio Programmable Voice (speech recognition ar-EG, text-to-speech). Needs an account and an Egyptian-reachable number.
// - "dev": local simulator only (no real call); the simulator screen plays the patient.
// - "disabled": no voice; journeys stay on WhatsApp and unanswered ones go to staff.
export function voiceMode(): "twilio" | "dev" | "disabled" {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.PUBLIC_BASE_URL) return "twilio";
  if (careSimulatorOn()) return "dev";
  return "disabled";
}

/** Local simulator: only with the development messaging mode, never with a real provider. */
export function careSimulatorOn() {
  return process.env.CARE_SIMULATOR === "on" && messagingMode() === "dev";
}

function secret() {
  return process.env.CARE_VOICE_SECRET || process.env.CRON_SECRET || "";
}
/** Per-journey token in the callback URLs so a URL cannot be replayed for another conversation. */
export function journeyToken(journeyId: string) {
  return createHmac("sha256", secret()).update(`care-voice:${journeyId}`).digest("hex").slice(0, 32);
}
export function checkJourneyToken(journeyId: string, token: string | null) {
  if (!secret() || !token) return false;
  const a = Buffer.from(journeyToken(journeyId)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Twilio request signature: HMAC-SHA1 over the full URL plus the sorted POST parameters. */
export function checkTwilioSignature(url: string, params: Record<string, string>, signature: string | null) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function voiceUrl(path: "twiml" | "turn" | "status", journeyId: string) {
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/care/voice/${path}?j=${journeyId}&t=${journeyToken(journeyId)}`;
}

export async function startCall(journeyId: string, to: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  const mode = voiceMode();
  if (mode === "dev") {
    console.info(`[care:voice:dev] call ${to} for journey ${journeyId} (play it from the simulator)`);
    return { ok: true, sid: `dev-call-${journeyId.slice(0, 8)}-${Date.now()}` };
  }
  if (mode !== "twilio") return { ok: false, error: "no voice provider configured" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const body = new URLSearchParams({
    To: to, From: process.env.TWILIO_FROM_NUMBER!, Url: voiceUrl("twiml", journeyId), Method: "POST",
    StatusCallback: voiceUrl("status", journeyId), StatusCallbackMethod: "POST", MachineDetection: "Enable", Timeout: "30",
  });
  body.append("StatusCallbackEvent", "completed");
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body, signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `HTTP ${res.status}` };
    return { ok: true, sid: json.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** TwiML for one turn: say the lines, then listen (or hang up at the end). */
export function twiml(lines: string[], opts: { lang: "ar" | "en"; listenUrl?: string; end?: boolean }) {
  const language = opts.lang === "en" ? "en-GB" : process.env.TWILIO_LANGUAGE ?? "ar-EG";
  const voice = opts.lang === "en" ? process.env.TWILIO_VOICE_EN ?? "Polly.Amy" : process.env.TWILIO_VOICE ?? "Google.ar-XA-Standard-A";
  const says = lines.filter(Boolean).map((l) => `<Say language="${language}" voice="${voice}">${esc(l)}</Say>`).join("");
  if (opts.end || !opts.listenUrl) return `<?xml version="1.0" encoding="UTF-8"?><Response>${says}<Hangup/></Response>`;
  const u = esc(opts.listenUrl);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" language="${language}" speechTimeout="auto" action="${u}" method="POST">${says}</Gather><Redirect method="POST">${u}&amp;silence=1</Redirect></Response>`;
}
