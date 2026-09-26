import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/server/admin";

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

// Delivery statuses. Signature-verified; idempotent and monotonic in the database.
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!secret) return new NextResponse("not configured", { status: 503 });
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new NextResponse("bad signature", { status: 401 });

  type Status = { id: string; status: string };
  let statuses: Status[] = [];
  try {
    const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: Status[] } }[] }[] };
    statuses = (body.entry ?? []).flatMap((e) => (e.changes ?? []).flatMap((c) => c.value?.statuses ?? []));
  } catch {
    return new NextResponse("bad request", { status: 400 });
  }
  const db = adminClient();
  for (const s of statuses) {
    if (["delivered", "read", "failed"].includes(s.status)) await db.rpc("svc_outbox_status", { p_provider_id: s.id, p_status: s.status });
  }
  return NextResponse.json({ received: statuses.length });
}
