import { voiceTurn } from "@/lib/care/runner";
import { readVoiceRequest, xml } from "../_auth";

export const dynamic = "force-dynamic";

// One spoken answer (speech recognised by the provider).
export async function POST(req: Request) {
  const r = await readVoiceRequest(req);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  return xml(await voiceTurn(r.journeyId, r.silence ? "" : r.params.SpeechResult ?? ""));
}
