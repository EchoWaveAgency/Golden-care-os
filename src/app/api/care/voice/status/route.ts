import { NextResponse } from "next/server";
import { voiceStatus } from "@/lib/care/runner";
import { readVoiceRequest } from "../_auth";

export const dynamic = "force-dynamic";

// Call progress: no answer / busy → retry later or hand to staff; completed → close the conversation.
export async function POST(req: Request) {
  const r = await readVoiceRequest(req);
  if (!r.ok) return new Response("forbidden", { status: 403 });
  const status = r.params.AnsweredBy?.startsWith("machine") ? "no-answer" : r.params.CallStatus ?? "";
  return NextResponse.json({ result: await voiceStatus(r.journeyId, r.params.CallSid ?? null, status) });
}
