"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}

export async function prepareSettlement(form: FormData) {
  const ctx = await getContext();
  const month = String(form.get("month"));
  const { data, error } = await ctx.supabase.rpc("prepare_settlement", { p_doctor: String(form.get("doctor_id")), p_month: `${month}-01` });
  if (error) go(`/os/settlements?m=${month}`, error, ctx.locale);
  redirect(`/os/settlements/${(data as { id: string }).id}`);
}

export async function cancelSettlement(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const { error } = await ctx.supabase.rpc("cancel_settlement", { p_run: id, p_reason: String(form.get("reason") ?? "") });
  go(`/os/settlements/${id}`, error, ctx.locale, "cancelled");
}

export async function approveSettlement(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const { error } = await ctx.supabase.rpc("approve_settlement", { p_run: id });
  go(`/os/settlements/${id}`, error, ctx.locale, "approved");
}

export async function paySettlement(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const { error } = await ctx.supabase.rpc("pay_settlement", { p_run: id, p_reference: String(form.get("reference") ?? ""), p_method: String(form.get("method") ?? "bank_transfer") });
  go(`/os/settlements/${id}`, error, ctx.locale, "paid");
}

// Remitting the tax withheld from doctors' fees to the Tax Authority.
export async function payWithholdingTax(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("pay_withholding_tax", { p_branch: ctx.branchId, p_period: String(form.get("period") ?? ""),
    p_amount: Number(form.get("amount") || 0), p_reference: String(form.get("reference") ?? "") });
  go("/os/settlements", error, ctx.locale, "wht_paid");
}

// Contract form: default % plus optional per-service rate (percent OR fixed amount per unit).
export async function saveContract(form: FormData) {
  const ctx = await getContext();
  const doctor = String(form.get("doctor_id"));
  const rates: { service_id: string; percent?: string; fixed_amount?: string }[] = [];
  for (const [k, v] of Array.from(form.entries())) {
    const m = /^rate_([0-9a-f-]{36})$/.exec(k);
    const value = String(v).trim();
    if (!m || !value) continue;
    const kind = String(form.get(`kind_${m[1]}`) ?? "percent");
    rates.push(kind === "fixed" ? { service_id: m[1], fixed_amount: value } : { service_id: m[1], percent: value });
  }
  const { error } = await ctx.supabase.rpc("save_doctor_contract", {
    p_doctor: doctor, p_from: String(form.get("from")), p_default_percent: Number(form.get("default_percent")),
    p_rates: rates, p_notes: String(form.get("notes") ?? "") || null, p_lab_cost_percent: Number(form.get("lab_cost_percent") || 0),
    p_withholding_percent: Number(form.get("withholding_percent") || 0), p_basis: String(form.get("basis") ?? "invoiced"),
  });
  go(`/os/settlements/contracts/${doctor}`, error, ctx.locale, "saved");
}
