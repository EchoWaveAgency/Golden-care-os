import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Online payment gateway adapter.
//   PAYMENTS_MODE=dev     → local simulator page (never in production)
//   PAYMENTS_MODE=paymob  → Paymob Accept "Intention" API + unified checkout
// The database confirms a payment ONLY from a verified server-side callback (svc_payment_confirm).

export type IntentInfo = { id: string; ref: string; amount: number; currency: string; invoice_no: string;
  first_name: string; last_name: string; phone: string; email: string | null };

/** Simulators only ever run against a local database, whatever the flags say. */
export function isLocalStack(): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

export function paymentsMode(): "dev" | "paymob" | "off" {
  const m = process.env.PAYMENTS_MODE;
  if (m === "paymob") return "paymob";
  if (m === "dev" && isLocalStack()) return "dev";
  return "off";
}

export function providerName(): string {
  return paymentsMode() === "paymob" ? "paymob" : "dev";
}

/** Returns the URL the patient is sent to, and the order id the callback will carry. */
export async function createCheckout(intent: IntentInfo, lang: "ar" | "en", siteUrl: string): Promise<{ url: string; orderId: string }> {
  const mode = paymentsMode();
  if (mode === "dev") return { url: `/${lang}/portal/pay/dev/${intent.id}`, orderId: intent.id };
  if (mode !== "paymob") throw new Error("online payments are not enabled");

  const secret = process.env.PAYMOB_SECRET_KEY;
  const publicKey = process.env.PAYMOB_PUBLIC_KEY;
  const integration = Number(process.env.PAYMOB_INTEGRATION_ID);
  if (!secret || !publicKey || !integration) throw new Error("Paymob is not configured");
  const cents = Math.round(intent.amount * 100);
  const res = await fetch(`${process.env.PAYMOB_API_BASE ?? "https://accept.paymob.com"}/v1/intention/`, {
    method: "POST",
    headers: { Authorization: `Token ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: cents, currency: intent.currency, payment_methods: [integration],
      items: [{ name: `Invoice ${intent.invoice_no}`, amount: cents, quantity: 1 }],
      billing_data: { first_name: intent.first_name || "Patient", last_name: intent.last_name || "-", phone_number: intent.phone,
                      email: intent.email || "no-email@goldencare.invalid", country: "EG" },
      special_reference: intent.id,                                    // echoed back as order.merchant_order_id
      notification_url: `${siteUrl}/api/webhooks/paymob`,
      redirection_url: `${siteUrl}/${lang}/portal/pay/return?intent=${intent.id}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`paymob intention failed: ${res.status}`);
  const j = (await res.json()) as { client_secret?: string; intention_order_id?: number | string };
  // The callback is matched on Paymob's own order id, which is covered by the HMAC signature
  // (merchant_order_id is not signed, so it is never trusted). Fail closed if it is missing.
  if (!j.client_secret || !j.intention_order_id) throw new Error("paymob intention: incomplete response");
  return { url: `https://accept.paymob.com/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(j.client_secret)}`, orderId: String(j.intention_order_id) };
}

// Paymob "transaction processed" callback: HMAC-SHA512 over these fields, in this order.
const HMAC_FIELDS = ["amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id",
  "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success"];

function pick(obj: Record<string, unknown>, path: string): string {
  const v = path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
  return v === undefined || v === null ? "" : String(v);
}

export function paymobHmacValid(obj: Record<string, unknown>, received: string | null, secret: string): boolean {
  if (!received) return false;
  const calc = createHmac("sha512", secret).update(HMAC_FIELDS.map((f) => pick(obj, f)).join("")).digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(received.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only fields covered by the HMAC decide the outcome. A capture counts as a payment only if it is
 *  a completed, standalone sale in EGP — not an authorisation, void, refund or child transaction. */
export function paymobResult(obj: Record<string, unknown>) {
  const f = (k: string) => pick(obj, k);
  const isSale = f("success") === "true" && f("pending") !== "true" && f("is_auth") !== "true" && f("is_voided") !== "true"
    && f("is_refunded") !== "true" && f("has_parent_transaction") !== "true" && f("currency") === "EGP";
  return { orderId: f("order.id"), txnId: f("id"), cents: Number(f("amount_cents")), success: isSale,
           error: isSale ? null : (f("data.message") || "not a completed sale") };
}
