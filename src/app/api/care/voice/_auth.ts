import "server-only";
import { checkJourneyToken, checkTwilioSignature, voiceMode } from "@/lib/care/voice";

/** Twilio callbacks: per-journey token in the URL plus Twilio's request signature over the public URL. */
export async function readVoiceRequest(req: Request) {
  const u = new URL(req.url);
  const j = u.searchParams.get("j") ?? "";
  const form = await req.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((v, k) => { params[k] = String(v); });
  if (!/^[0-9a-f-]{36}$/.test(j) || !checkJourneyToken(j, u.searchParams.get("t"))) return { ok: false as const };
  if (voiceMode() !== "twilio") return { ok: false as const };
  const publicUrl = `${(process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "")}${u.pathname}${u.search}`;
  if (!checkTwilioSignature(publicUrl, params, req.headers.get("x-twilio-signature"))) return { ok: false as const };
  return { ok: true as const, journeyId: j, params, silence: u.searchParams.get("silence") === "1" };
}

export const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
