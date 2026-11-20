import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

// Events from HORUS Engage (WhatsApp / Messenger / Instagram / comments automation): lead, booking request, handoff.
// Signed with the client's Engage secret (X-Engage-Signature: sha256=HMAC). Idempotent per event id.
// The response {"ref": "<lead id>"} is stored by Engage on the booking.
export async function POST(req: Request) {
  const secret = process.env.ENGAGE_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await req.text();
  const sig = req.headers.get("x-engage-signature") ?? "";
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  const { data, error } = await adminClient().rpc("svc_lead_external", { p });
  if (error) {
    const client = /unknown event|event id|invalid phone/.test(error.message);
    return NextResponse.json({ error: client ? error.message : "failed" }, { status: client ? 400 : 500 });   // 5xx → Engage retries
  }
  const r = data as { action: string; ref?: string };
  return NextResponse.json({ ok: true, action: r.action, ref: r.ref ?? null });
}
