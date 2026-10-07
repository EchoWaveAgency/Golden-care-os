"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}

export async function requestSupplierReturn(form: FormData) {
  const ctx = await getContext();
  const receipt = s(form, "receipt_id");
  const lines = Array.from(form.keys()).filter((k) => k.startsWith("qty_")).map((k) => ({ lot_id: k.slice(4), qty: Number(s(form, k) || 0) })).filter((l) => l.qty > 0);
  const { error } = await ctx.supabase.rpc("request_supplier_return", { p_receipt: receipt, p_lines: lines, p_reason: s(form, "reason") });
  go(error ? `/os/inventory/returns?receipt=${receipt}` : "/os/inventory/returns", error, ctx.locale, "requested");
}

export async function decideSupplierReturn(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_supplier_return", { p_return: s(form, "id"), p_approve: form.get("decision") === "approve", p_note: s(form, "note") || null });
  go("/os/inventory/returns", error, ctx.locale, "decided");
}
