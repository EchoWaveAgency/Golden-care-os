import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/server/admin";
import { processInbound } from "@/lib/care/runner";
import { historyText, messageTime, parseWhatsAppWebhook, type InboundMessage, type StatusUpdate } from "@/lib/leads-flow";

export const dynamic = "force-dynamic";

// Meta webhook verification handshake.
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN &&
      u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// Delivery statuses and customer messages. Signature-verified; idempotent per Meta message id.
// For every customer message, in this order:
//   1. lead capture (svc_lead_capture): a message from an ad (referral), carrying a campaign code / keyword, or from
//      a number with an open lead is stored on its lead — with the WhatsApp name, ad id and click id — and shows
//      immediately in the call center. Nothing else is created here.
//   2. the care assistant (processInbound): safety rules and danger signs first, open patient conversations, opt-out;
//      anything outside a conversation reaches the call center through the same lead (or a ticket for a patient).
// If either step could not store the message, Meta is asked to deliver again (503); both steps ignore repeats.
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse("bad signature", { status: 401 });

  let statuses: StatusUpdate[] = [];
  let messages: InboundMessage[] = [];
  try {
    ({ statuses, messages } = parseWhatsAppWebhook(raw));
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const db = adminClient();
  for (const s of statuses) {
    if (["delivered", "read", "failed"].includes(s.status)) {
      await db.rpc("svc_outbox_status", { p_provider_id: s.id, p_status: s.status });
      await db.rpc("svc_care_message_status", { p_provider_id: s.id, p_status: s.status });
      await db.rpc("svc_lead_message_status", { p_provider_id: s.id, p_status: s.status });
    }
  }
  let unstored = 0;
  const leads: string[] = [];
  for (const m of messages) {
    const { data: lead, error: leadErr } = await db.rpc("svc_lead_capture", { p: {
      phone: m.from, name: m.name, provider_id: m.id, text: historyText(m), kind: m.kind, referral: m.referral,
      received_at: messageTime(m.timestamp),
    } });
    if (leadErr) {
      unstored++;
      console.error(`[leads] inbound ${m.id} not captured: ${leadErr.message}`);
      continue;   // retried by Meta; the care step runs on the retry
    }
    const code = (lead as { code?: string } | null)?.code;
    if (code) leads.push(code);
    try {
      await processInbound({ phone: m.from, text: m.text, providerId: m.id, kind: m.kind, mediaId: m.mediaId });
    } catch (e) {
      unstored++;   // not stored at all: ask Meta to deliver again
      console.error(`[care] inbound ${m.id} not stored: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (unstored) return NextResponse.json({ error: "retry" }, { status: 503 });
  return NextResponse.json({ received: statuses.length + messages.length, leads });
}
