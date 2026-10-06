import { voiceOpen } from "@/lib/care/runner";
import { readVoiceRequest, xml } from "../_auth";

export const dynamic = "force-dynamic";

// Call answered: greeting and identity check.
export async function POST(req: Request) {
  const r = await readVoiceRequest(req);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  return xml(await voiceOpen(r.journeyId, r.params.AnsweredBy ?? null));
}
