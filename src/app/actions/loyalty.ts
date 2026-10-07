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
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function redeemLoyalty(form: FormData) {
  const ctx = await getContext();
  const inv = s(form, "invoice_id");
  const { error } = await ctx.supabase.rpc("redeem_loyalty", { p_invoice: inv, p_points: Number(s(form, "points") || 0), p_idempotency_key: s(form, "idempotency_key") });
  go(`/os/billing/${inv}`, error, ctx.locale, "points_redeemed");
}

export async function createReferralCode(form: FormData) {
  const ctx = await getContext();
  const p = s(form, "patient_id");
  const { error } = await ctx.supabase.rpc("patient_referral_code", { p_patient: p });
  go(`/os/patients/${p}`, error, ctx.locale, "referral_code");
}

export async function setReferrer(form: FormData) {
  const ctx = await getContext();
  const p = s(form, "patient_id");
  const { error } = await ctx.supabase.rpc("set_referrer", { p_patient: p, p_code: s(form, "code") });
  go(`/os/patients/${p}`, error, ctx.locale, "referrer_set");
}

export async function saveLoyaltySettings(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_loyalty_settings", { p: {
    enabled: form.get("enabled") === "on", points_per_egp: s(form, "points_per_egp"), egp_per_point: s(form, "egp_per_point"),
    min_redeem_points: s(form, "min_redeem_points"), max_redeem_percent: s(form, "max_redeem_percent"), expiry_months: s(form, "expiry_months"),
    referral_bonus_points: s(form, "referral_bonus_points"),
  } });
  go("/os/accounting/clearing", error, ctx.locale, "loyalty_saved");
}

export async function recordClearingSettlement(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("record_clearing_settlement", { p_branch: ctx.branchId, p_key: s(form, "key"), p_date: s(form, "date"),
    p_gross: Number(s(form, "gross") || 0), p_fees: Number(s(form, "fees") || 0), p_reference: s(form, "reference") });
  go("/os/accounting/clearing", error, ctx.locale, "settled");
}
