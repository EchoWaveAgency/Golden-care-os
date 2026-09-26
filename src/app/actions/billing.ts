"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import type { FormState } from "@/components/FormMessage";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createInvoice(form: FormData) {
  const ctx = await getContext();
  const patientId = String(form.get("patient_id") ?? "");
  const appointmentId = String(form.get("appointment_id") ?? "") || null;
  if (!ctx.branchId) fail(`/os/patients/${patientId}`, friendlyError("permission denied", ctx.locale));
  const { data, error } = await ctx.supabase
    .from("invoices")
    .insert({ branch_id: ctx.branchId, patient_id: patientId, appointment_id: appointmentId })
    .select("id")
    .single();
  if (error) fail(`/os/patients/${patientId}`, friendlyError(error.message, ctx.locale));
  redirect(`/os/billing/${data.id}`);
}

const LineInput = z.object({
  invoice_id: z.string().uuid(),
  service_id: z.string().uuid(),
  doctor_id: z.string().uuid().optional().or(z.literal("")),
  quantity: z.coerce.number().positive().max(1000),
  discount: z.coerce.number().min(0).default(0),
});

export async function addInvoiceLine(form: FormData) {
  const ctx = await getContext();
  const parsed = LineInput.safeParse(Object.fromEntries(form.entries()));
  const path = `/os/billing/${form.get("invoice_id")}`;
  if (!parsed.success) fail(path, ctx.locale === "ar" ? "راجع بيانات البند." : "Check the line details.");
  const v = parsed.data;

  const { data: inv } = await ctx.supabase.from("invoices").select("branch_id, appointment_id").eq("id", v.invoice_id).single();
  // Price never comes from the browser: an offer frozen on the appointment wins, else the effective price list.
  let price: number | null = null;
  if (inv?.appointment_id) {
    const { data: apt } = await ctx.supabase.from("appointments").select("offer_price, offer_terms").eq("id", inv.appointment_id).maybeSingle();
    if (apt?.offer_price != null && (apt.offer_terms as { service_id?: string } | null)?.service_id === v.service_id) {
      price = Number(apt.offer_price);
    }
  }
  if (price == null) {
    const { data: listPrice, error: pErr } = await ctx.supabase.rpc("service_price", { p_service: v.service_id, p_branch: inv?.branch_id });
    if (pErr || listPrice == null) fail(path, ctx.locale === "ar" ? "لا يوجد سعر ساري لهذه الخدمة في قائمة الأسعار." : "No effective price for this service.");
    price = Number(listPrice);
  }

  const { error } = await ctx.supabase.from("invoice_lines").insert({
    invoice_id: v.invoice_id,
    service_id: v.service_id,
    doctor_id: v.doctor_id || null,
    quantity: v.quantity,
    unit_price: price,
    discount: v.discount,
  });
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  revalidatePath(path);
  redirect(path);
}

export async function removeInvoiceLine(form: FormData) {
  const ctx = await getContext();
  const path = `/os/billing/${form.get("invoice_id")}`;
  const { error } = await ctx.supabase.from("invoice_lines").delete().eq("id", String(form.get("line_id")));
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  revalidatePath(path);
  redirect(path);
}

export async function issueInvoice(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("invoice_id"));
  const { error } = await ctx.supabase.rpc("issue_invoice", { p_invoice: id });
  if (error) fail(`/os/billing/${id}`, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/billing/${id}`);
  redirect(`/os/billing/${id}`);
}

const PaymentInput = z.object({
  invoice_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  method: z.string().min(2),
  reference: z.string().trim().max(80).optional(),
  idempotency_key: z.string().min(10),
});

export async function recordPayment(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await getContext();
  const parsed = PaymentInput.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: ctx.locale === "ar" ? "راجع بيانات الدفعة." : "Check the payment details." };
  const v = parsed.data;
  const { error } = await ctx.supabase.rpc("record_payment", {
    p_invoice: v.invoice_id,
    p_amount: v.amount,
    p_method: v.method,
    p_idempotency_key: v.idempotency_key,
    p_reference: v.reference || null,
  });
  if (error) return { error: friendlyError(error.message, ctx.locale) };
  revalidatePath(`/os/billing/${v.invoice_id}`);
  redirect(`/os/billing/${v.invoice_id}?paid=1`);
}

export async function voidInvoice(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("invoice_id"));
  const reason = String(form.get("reason") ?? "").trim();
  const { error } = await ctx.supabase.rpc("void_invoice", { p_invoice: id, p_reason: reason });
  if (error) fail(`/os/billing/${id}`, friendlyError(error.message, ctx.locale));
  revalidatePath(`/os/billing/${id}`);
  redirect(`/os/billing/${id}`);
}

export async function openCashierSession(form: FormData) {
  const ctx = await getContext();
  const float = Number(form.get("opening_float") ?? 0);
  const { error } = await ctx.supabase.rpc("open_cashier_session", { p_branch: ctx.branchId, p_opening_float: float });
  if (error) fail("/os/cashier", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/cashier");
  redirect("/os/cashier");
}

export async function closeCashierSession(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("close_cashier_session", {
    p_session: String(form.get("session_id")),
    p_counted: Number(form.get("counted") ?? NaN),
    p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) return { error: friendlyError(error.message, ctx.locale) };
  revalidatePath("/os/cashier");
  redirect("/os/cashier?closed=1");
}
