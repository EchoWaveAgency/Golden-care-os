"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const json = (form: FormData, k: string) => { try { return JSON.parse(String(form.get(k) ?? "[]")); } catch { return []; } };

export async function createPo(form: FormData) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc("create_po", {
    p_location: String(form.get("location_id")), p_supplier: String(form.get("supplier_id")), p_lines: json(form, "lines"),
    p_expected: String(form.get("expected_on") ?? "") || null, p_notes: String(form.get("notes") ?? "") || null,
  });
  if (error) go("/os/purchasing/new", error, ctx.locale);
  redirect(`/os/purchasing/${(data as { id: string }).id}`);
}

async function poStep(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const ctx = await getContext();
  const id = String(form.get("po_id"));
  const { error } = await ctx.supabase.rpc(fn, { p_po: id, ...args });
  go(`/os/purchasing/${id}`, error, ctx.locale, ok);
}
export async function submitPo(form: FormData) { await poStep(form, "submit_po", {}, "submitted"); }
export async function approvePo(form: FormData) { await poStep(form, "approve_po", {}, "approved"); }
export async function cancelPo(form: FormData) { await poStep(form, "cancel_po", { p_reason: String(form.get("reason") ?? "") }, "cancelled"); }

export async function closePo(form: FormData) { await poStep(form, "close_po", { p_reason: String(form.get("reason") ?? "") }, "closed"); }

export async function receivePo(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("po_id"));
  const lines = Array.from(form.entries()).filter(([k]) => k.startsWith("qty_")).map(([k, v]) => {
    const line = k.slice(4);
    return { po_line_id: line, qty: Number(v || 0), lot_no: String(form.get(`lot_${line}`) ?? ""), expiry: String(form.get(`exp_${line}`) ?? "") };
  }).filter((l) => l.qty > 0);
  const { error } = await ctx.supabase.rpc("receive_po", {
    p_po: id, p_supplier_invoice_no: String(form.get("supplier_invoice_no") ?? ""), p_lines: lines, p_idempotency_key: String(form.get("idempotency_key")),
  });
  go(`/os/purchasing/${id}`, error, ctx.locale, "received");
}

export async function requestSupplierPayment(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  // pay_<receipt id> = goods receipt, payb_<bill id> = supplier bill (lab work, maintenance)
  const allocations = Array.from(form.entries()).filter(([k, v]) => /^payb?_/.test(k) && Number(v) > 0)
    .map(([k, v]) => (k.startsWith("payb_") ? { bill_id: k.slice(5), amount: Number(v) } : { receipt_id: k.slice(4), amount: Number(v) }));
  const { error } = await ctx.supabase.rpc("request_supplier_payment", {
    p_supplier: sup, p_allocations: allocations, p_method: String(form.get("method")), p_reference: String(form.get("reference") ?? ""),
  });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "requested");
}

export async function decideSupplierPayment(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  const { error } = await ctx.supabase.rpc("decide_supplier_payment", {
    p_payment: String(form.get("payment_id")), p_approve: form.get("decision") === "approve", p_note: String(form.get("note") ?? "") || null,
  });
  go(`/os/suppliers/${sup}`, error, ctx.locale, form.get("decision") === "approve" ? "paid" : "rejected");
}

export async function confirmReceipt(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  const { error } = await ctx.supabase.rpc("confirm_receipt", { p_receipt: String(form.get("receipt_id")) });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "confirmed");
}

// Purchasing settings (chief accountant): approval thresholds and the VAT treatment.
export async function savePurchasingSettings(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_purchasing_settings", { p: {
    po_high_approval_above: String(form.get("po_high_approval_above") ?? ""),
    payment_high_approval_above: String(form.get("payment_high_approval_above") ?? ""),
    vat_treatment: String(form.get("vat_treatment") ?? ""),
  } });
  go("/os/purchasing", error, ctx.locale, "settings");
}

export async function setReceiptVat(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  const { error } = await ctx.supabase.rpc("set_receipt_vat", { p_receipt: String(form.get("receipt_id")), p_vat: Number(form.get("vat") || 0),
    p_tax_invoice_no: String(form.get("tax_invoice_no") ?? "") });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "vat");
}

export async function applySupplierCredit(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  const { error } = await ctx.supabase.rpc("apply_supplier_credit", { p_credit: String(form.get("credit_id")), p_receipt: String(form.get("receipt_id")),
    p_amount: Number(form.get("amount") || 0) });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "credit_applied");
}

export async function recordSupplierRefund(form: FormData) {
  const ctx = await getContext();
  const sup = String(form.get("supplier_id"));
  const { error } = await ctx.supabase.rpc("record_supplier_refund", { p_credit: String(form.get("credit_id")), p_amount: Number(form.get("amount") || 0),
    p_method: String(form.get("method") ?? "bank_transfer"), p_reference: String(form.get("reference") ?? "") });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "credit_refunded");
}
