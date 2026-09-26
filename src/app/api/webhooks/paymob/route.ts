import { NextResponse } from "next/server";
import { adminClient } from "@/lib/server/admin";
import { paymobHmacValid, paymobResult } from "@/lib/payments/gateway";

export const dynamic = "force-dynamic";

// Paymob server-to-server callback. The signature is verified before anything is read;
// confirmation is idempotent in the database, so retries from Paymob are harmless.
export async function POST(req: Request) {
  const secret = process.env.PAYMOB_HMAC_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const hmac = new URL(req.url).searchParams.get("hmac");
  let body: { type?: string; obj?: Record<string, unknown> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad request" }, { status: 400 }); }
  if (body.type !== "TRANSACTION" || !body.obj) return NextResponse.json({ ignored: true });
  if (!paymobHmacValid(body.obj, hmac, secret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  const r = paymobResult(body.obj);
  if (!/^\d+$/.test(r.orderId) || !r.txnId) return NextResponse.json({ ignored: true });
  const { data, error } = await adminClient().rpc("svc_payment_confirm", {
    p_provider: "paymob", p_order_id: r.orderId, p_txn_id: r.txnId, p_amount_cents: r.cents, p_success: r.success, p_error: r.error,
  });
  if (error) return NextResponse.json({ error: "retry" }, { status: 500 });   // Paymob retries
  // "unknown" / "exception" are recorded in payment_exceptions for finance to resolve.
  if (data === "unknown" || data === "exception") console.warn(`[paymob] unmatched capture txn=${r.txnId} status=${data}`);
  return NextResponse.json({ status: data });
}
