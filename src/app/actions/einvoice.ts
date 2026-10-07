"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath("/os/accounting/einvoice");
  redirect(`/os/accounting/einvoice${error ? `?error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `?ok=${ok}` : ""}`);
}

export async function saveEinvoiceSettings(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_einvoice_settings", { p: {
    enabled: form.get("enabled") === "on", document_kind: s(form, "document_kind"), environment: s(form, "environment"),
    taxpayer_rin: s(form, "taxpayer_rin"), taxpayer_name: s(form, "taxpayer_name"), activity_code: s(form, "activity_code"),
    branch_code: s(form, "branch_code"), pos_serial: s(form, "pos_serial") } });
  go(error, ctx.locale, "saved");
}

export async function setServiceTax(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("set_service_tax", { p_service: s(form, "service_id"), p: {
    eta_item_type: s(form, "eta_item_type"), eta_item_code: s(form, "eta_item_code"), eta_unit: s(form, "eta_unit"),
    tax_type: s(form, "tax_type"), tax_subtype: s(form, "tax_subtype"), tax_rate: s(form, "tax_rate") } });
  go(error, ctx.locale, "service");
}

export async function retryEinvoice(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("einvoice_retry", { p_doc: s(form, "id") });
  go(error, ctx.locale, "retried");
}
