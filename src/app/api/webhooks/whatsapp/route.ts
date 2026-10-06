import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/server/admin";
import { processInbound } from "@/lib/care/runner";

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

// Delivery statuses and patient messages. Signature-verified; idempotent and monotonic in the database.
// Patient messages go to the care assistant (open conversation → next step; otherwise ticket / lead / escalation).
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse("bad signature", { status: 401 });

  type Status = { id: string; status: string };
  type Incoming = { from: string; id: string; type: string; text?: { body?: string }; button?: { text?: string };
    interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
    audio?: { id?: string }; image?: { id?: string; caption?: string }; document?: { id?: string; caption?: string }; video?: { id?: string; caption?: string } };
  let statuses: Status[] = [];
  let messages: Incoming[] = [];
  try {
    const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: Status[]; messages?: Incoming[] } }[] }[] };
    const values = (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value ?? {}));
    statuses = values.flatMap((v) => v.statuses ?? []);
    messages = values.flatMap((v) => v.messages ?? []);
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const db = adminClient();
  for (const s of statuses) {
    if (["delivered", "read", "failed"].includes(s.status)) {
      await db.rpc("svc_outbox_status", { p_provider_id: s.id, p_status: s.status });
      await db.rpc("svc_care_message_status", { p_provider_id: s.id, p_status: s.status });
    }
  }
  let unstored = 0;
  for (const m of messages) {
    const media = m.audio ?? m.image ?? m.document ?? m.video;
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
      ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? "";
    const kind = m.type === "audio" ? "audio" : ["image", "document", "video", "sticker"].includes(m.type) ? "media" : "text";
    try {
      await processInbound({ phone: m.from, text, providerId: m.id, kind, mediaId: media?.id ?? null });
    } catch (e) {
      unstored++;   // not stored at all: ask Meta to deliver again
      console.error(`[care] inbound ${m.id} not stored: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (unstored) return NextResponse.json({ error: "retry" }, { status: 503 });
  return NextResponse.json({ received: statuses.length + messages.length });
}
