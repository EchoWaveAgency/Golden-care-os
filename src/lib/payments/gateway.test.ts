import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("server-only", () => ({}));
const { paymobHmacValid, paymobResult, paymentsMode } = await import("./gateway");

const FIELDS = ["amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id",
  "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner", "pending",
  "source_data.pan", "source_data.sub_type", "source_data.type", "success"];
const obj = {
  amount_cents: 50000, created_at: "2026-09-26T12:00:00", currency: "EGP", error_occured: false, has_parent_transaction: false, id: 991,
  integration_id: 7, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 12345, merchant_order_id: "attacker-chosen" }, owner: 1, pending: false,
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
};
const sign = (o: Record<string, unknown>, secret: string) => createHmac("sha512", secret).update(FIELDS.map((f) =>
  String(f.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown>)[k], o))).join("")).digest("hex");

describe("paymob callback", () => {
  it("accepts a correct signature and rejects tampering", () => {
    const h = sign(obj, "s3cret");
    expect(paymobHmacValid(obj, h, "s3cret")).toBe(true);
    expect(paymobHmacValid({ ...obj, amount_cents: 1 }, h, "s3cret")).toBe(false);
    expect(paymobHmacValid(obj, h, "other")).toBe(false);
    expect(paymobHmacValid(obj, null, "s3cret")).toBe(false);
  });
  it("uses the signed order id, never merchant_order_id", () => {
    expect(paymobResult(obj).orderId).toBe("12345");
  });
  it("only a completed standalone EGP sale counts as paid", () => {
    expect(paymobResult(obj).success).toBe(true);
    expect(paymobResult({ ...obj, pending: true }).success).toBe(false);
    expect(paymobResult({ ...obj, is_voided: true }).success).toBe(false);
    expect(paymobResult({ ...obj, is_refunded: true }).success).toBe(false);
    expect(paymobResult({ ...obj, is_auth: true }).success).toBe(false);
    expect(paymobResult({ ...obj, has_parent_transaction: true }).success).toBe(false);
    expect(paymobResult({ ...obj, currency: "USD" }).success).toBe(false);
  });
  it("the simulator never runs against a remote database", () => {
    process.env.PAYMENTS_MODE = "dev";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    expect(paymentsMode()).toBe("off");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    expect(paymentsMode()).toBe("dev");
  });
});
