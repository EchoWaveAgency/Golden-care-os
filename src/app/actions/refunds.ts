"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path);
  redirect(`${path}${error ? `?error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `?ok=${ok}` : ""}`);
}

export async function requestRefund(form: FormData) {
  const ctx = await getContext();
  const inv = String(form.get("invoice_id"));
  const { error } = await ctx.supabase.rpc("request_refund", {
    p_invoice: inv, p_amount: Number(form.get("amount")), p_method: String(form.get("method")), p_reason: String(form.get("reason") ?? ""),
  });
  go(`/os/billing/${inv}`, error, ctx.locale, "refund_requested");
}

export async function decideRefund(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_refund", {
    p_refund: String(form.get("id")), p_approve: form.get("decision") === "approve", p_note: String(form.get("note") ?? "") || null,
  });
  go("/os/refunds", error, ctx.locale, "decided");
}

export async function payRefund(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("pay_refund", { p_refund: String(form.get("id")), p_reference: String(form.get("reference") ?? "") || null });
  go("/os/refunds", error, ctx.locale, "paid");
}
