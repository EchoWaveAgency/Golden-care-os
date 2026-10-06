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
const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();
const json = (form: FormData, k: string) => { try { return JSON.parse(s(form, k) || "[]"); } catch { return []; } };

/** New draft plan from the patient file, or saves the draft editor. */
export async function savePlan(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "plan_id");
  const patient = s(form, "patient_id");
  const { data, error } = await ctx.supabase.rpc("save_treatment_plan", {
    p: { id, patient_id: patient, branch_id: ctx.branchId, title: s(form, "title"), notes: s(form, "notes"), items: json(form, "items") },
  });
  if (error) go(id ? `/os/plans/${id}` : s(form, "back") || `/os/patients/${patient}`, error, ctx.locale);
  go(`/os/plans/${(data as { id: string }).id}`, null, ctx.locale, id ? "saved" : "created");
}

async function planStep(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const ctx = await getContext();
  const id = s(form, "plan_id");
  const { error } = await ctx.supabase.rpc(fn, { p_plan: id, ...args });
  go(`/os/plans/${id}`, error, ctx.locale, ok);
}
export async function proposePlan(form: FormData) { await planStep(form, "propose_plan", { p_valid_days: Number(s(form, "valid_days") || 30) }, "proposed"); }
export async function revisePlan(form: FormData) { await planStep(form, "revise_plan", {}, "revised"); }
export async function cancelPlan(form: FormData) { await planStep(form, "cancel_plan", { p_reason: s(form, "reason") }, "cancelled"); }
export async function acceptPlan(form: FormData) {
  await planStep(form, "accept_plan", { p_method: s(form, "method"), p_installments: json(form, "installments"), p_note: s(form, "note") || null }, "accepted");
}

export async function completeItem(form: FormData) {
  const ctx = await getContext();
  const plan = s(form, "plan_id");
  const { error } = await ctx.supabase.rpc("complete_plan_item", { p_item: s(form, "item_id"), p_appointment: s(form, "appointment_id") || null, p_note: s(form, "note") || null });
  go(`/os/plans/${plan}`, error, ctx.locale, "done");
}
export async function cancelItem(form: FormData) {
  const ctx = await getContext();
  const plan = s(form, "plan_id");
  const { error } = await ctx.supabase.rpc("cancel_plan_item", { p_item: s(form, "item_id"), p_reason: s(form, "reason") });
  go(`/os/plans/${plan}`, error, ctx.locale, "item_cancelled");
}

/** Bills completed items, applies the advance, and opens the invoice to collect the rest. */
export async function billPlan(form: FormData) {
  const ctx = await getContext();
  const plan = s(form, "plan_id");
  const { data, error } = await ctx.supabase.rpc("bill_plan_items", { p_plan: plan, p_appointment: s(form, "appointment_id") || null });
  if (error) go(`/os/plans/${plan}`, error, ctx.locale);
  redirect(`/os/billing/${(data as { id: string }).id}?ok=plan_billed`);
}

export async function createLabCase(form: FormData) {
  const ctx = await getContext();
  const back = s(form, "back") || "/os/lab";
  const { error } = await ctx.supabase.rpc("create_lab_case", {
    p: { plan_item_id: s(form, "plan_item_id"), patient_id: s(form, "patient_id"), branch_id: ctx.branchId, service_id: s(form, "service_id"),
      lab_id: s(form, "lab_id"), work_type: s(form, "work_type"), shade: s(form, "shade"), teeth: s(form, "teeth"),
      instructions: s(form, "instructions"), due_on: s(form, "due_on") },
  });
  go(back, error, ctx.locale, "lab_created");
}

export async function setLabStatus(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("lab_case_set_status", { p_case: s(form, "case_id"), p_status: s(form, "status"), p_note: s(form, "note") || null });
  go(s(form, "back") || "/os/lab", error, ctx.locale, "lab_updated");
}

// ---------- Patient advances
export async function recordDeposit(form: FormData) {
  const ctx = await getContext();
  const patient = s(form, "patient_id");
  const back = s(form, "back") || `/os/patients/${patient}`;
  const { error } = await ctx.supabase.rpc("record_deposit", {
    p_patient: patient, p_branch: ctx.branchId, p_amount: Number(s(form, "amount")), p_method: s(form, "method"),
    p_idempotency_key: s(form, "idempotency_key"), p_reference: s(form, "reference") || null, p_plan: s(form, "plan_id") || null,
  });
  go(back, error, ctx.locale, "deposit");
}

export async function applyAdvance(form: FormData) {
  const ctx = await getContext();
  const inv = s(form, "invoice_id");
  const { error } = await ctx.supabase.rpc("apply_advance", { p_invoice: inv, p_amount: Number(s(form, "amount")), p_idempotency_key: s(form, "idempotency_key") });
  go(`/os/billing/${inv}`, error, ctx.locale, "advance_applied");
}

export async function requestDepositRefund(form: FormData) {
  const ctx = await getContext();
  const patient = s(form, "patient_id");
  const { error } = await ctx.supabase.rpc("request_deposit_refund", {
    p_patient: patient, p_branch: ctx.branchId, p_amount: Number(s(form, "amount")), p_method: s(form, "method"), p_reason: s(form, "reason"),
  });
  go(`/os/patients/${patient}`, error, ctx.locale, "refund_requested");
}

export async function decideDepositRefund(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_deposit_refund", {
    p_refund: s(form, "id"), p_approve: form.get("decision") === "approve", p_note: s(form, "note") || null,
  });
  go("/os/refunds", error, ctx.locale, "decided");
}

export async function payDepositRefund(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("pay_deposit_refund", { p_refund: s(form, "id"), p_reference: s(form, "reference") || null });
  go("/os/refunds", error, ctx.locale, "paid");
}

// ---------- Supplier bills (lab work, maintenance)
export async function recordSupplierBill(form: FormData) {
  const ctx = await getContext();
  const back = s(form, "back") || "/os/lab";
  const { error } = await ctx.supabase.rpc("record_supplier_bill", {
    p: { kind: s(form, "kind"), supplier_id: s(form, "supplier_id"), lab_case_id: s(form, "lab_case_id"), maintenance_order_id: s(form, "maintenance_order_id"),
      bill_no: s(form, "bill_no"), bill_date: s(form, "bill_date"), amount: Number(s(form, "amount")), description: s(form, "description") },
  });
  go(back, error, ctx.locale, "bill");
}

export async function confirmSupplierBill(form: FormData) {
  const ctx = await getContext();
  const sup = s(form, "supplier_id");
  const { error } = await ctx.supabase.rpc("confirm_supplier_bill", { p_bill: s(form, "bill_id") });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "bill_confirmed");
}

export async function voidSupplierBill(form: FormData) {
  const ctx = await getContext();
  const sup = s(form, "supplier_id");
  const { error } = await ctx.supabase.rpc("void_supplier_bill", { p_bill: s(form, "bill_id"), p_reason: s(form, "reason") });
  go(`/os/suppliers/${sup}`, error, ctx.locale, "voided");
}
