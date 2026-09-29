"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath("/os/inventory");
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const lines = (form: FormData) => { try { return JSON.parse(String(form.get("lines") ?? "[]")); } catch { return []; } };

export async function receiveGoods(form: FormData) {
  const ctx = await getContext();
  const loc = String(form.get("location_id"));
  const { data, error } = await ctx.supabase.rpc("receive_goods", {
    p_location: loc, p_supplier: String(form.get("supplier_id")), p_supplier_invoice_no: String(form.get("supplier_invoice_no") ?? ""),
    p_lines: lines(form), p_idempotency_key: String(form.get("idempotency_key")),
  });
  if (error) go(`/os/inventory/receive?loc=${loc}`, error, ctx.locale);
  go(`/os/inventory?loc=${loc}`, null, ctx.locale, `received:${(data as { ref: string }).ref}`);
}

export async function issueStock(form: FormData) {
  const ctx = await getContext();
  const loc = String(form.get("location_id"));
  const apt = String(form.get("appointment_id") ?? "") || null;
  const { data, error } = await ctx.supabase.rpc("issue_stock", {
    p_location: loc, p_items: lines(form), p_appointment: apt, p_reason: String(form.get("reason") ?? "") || null,
    p_idempotency_key: String(form.get("idempotency_key")),
  });
  if (error) go(`/os/inventory/issue?loc=${loc}${apt ? `&appointment=${apt}` : ""}`, error, ctx.locale);
  go(`/os/inventory/issue?loc=${loc}`, null, ctx.locale, `issued:${(data as { ref: string }).ref}`);
}

export async function startCount(form: FormData) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc("start_count", { p_location: String(form.get("location_id")) });
  if (error) go("/os/inventory/counts", error, ctx.locale);
  redirect(`/os/inventory/counts/${(data as { id: string }).id}`);
}

export async function submitCount(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("count_id"));
  const payload = Array.from(form.entries()).filter(([k]) => k.startsWith("lot_"))
    .map(([k, v]) => ({ lot_id: k.slice(4), counted: String(v).trim() === "" ? null : Number(v) }));
  const { error } = await ctx.supabase.rpc("submit_count", { p_count: id, p_lines: payload });
  go(`/os/inventory/counts/${id}`, error, ctx.locale, "submitted");
}

export async function approveCount(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("count_id"));
  const { error } = await ctx.supabase.rpc("approve_count", { p_count: id });
  go(`/os/inventory/counts/${id}`, error, ctx.locale, "approved");
}

export async function cancelCount(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("count_id"));
  const { error } = await ctx.supabase.rpc("cancel_count", { p_count: id, p_reason: String(form.get("reason") ?? "") });
  go(`/os/inventory/counts/${id}`, error, ctx.locale, "cancelled");
}

// Master data (RLS: inventory.manage; audit triggers record every change).
export async function saveItem(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id") ?? "");
  const row = {
    code: String(form.get("code") ?? "").trim().toUpperCase(), name_ar: String(form.get("name_ar") ?? "").trim(), name_en: String(form.get("name_en") ?? "").trim(),
    unit: String(form.get("unit") ?? "piece").trim() || "piece", category: String(form.get("category") ?? "consumable"),
    is_controlled: form.get("is_controlled") === "on", reorder_level: Number(form.get("reorder_level") || 0), is_active: form.get("is_active") !== "off",
  };
  const { error } = id ? await ctx.supabase.from("inv_items").update(row).eq("id", id) : await ctx.supabase.from("inv_items").insert(row);
  go("/os/inventory/catalog", error, ctx.locale, "saved");
}

export async function saveSupplier(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("suppliers").insert({
    name_ar: String(form.get("name_ar") ?? "").trim(), name_en: String(form.get("name_en") ?? "").trim() || null,
    tax_id: String(form.get("tax_id") ?? "").trim() || null, phone: String(form.get("phone") ?? "").trim() || null,
  });
  go("/os/inventory/catalog", error, ctx.locale, "saved");
}

export async function saveLocation(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.from("inv_locations").insert({
    branch_id: String(form.get("branch_id")), code: String(form.get("code") ?? "").trim().toUpperCase(),
    name_ar: String(form.get("name_ar") ?? "").trim(), name_en: String(form.get("name_en") ?? "").trim(),
  });
  go("/os/inventory/catalog", error, ctx.locale, "saved");
}

export async function saveTemplate(form: FormData) {
  const ctx = await getContext();
  const service = String(form.get("service_id"));
  const item = String(form.get("item_id"));
  const qty = Number(form.get("qty") || 0);
  const { error } = qty > 0
    ? await ctx.supabase.from("service_consumables").upsert({ service_id: service, item_id: item, qty })
    : await ctx.supabase.from("service_consumables").delete().eq("service_id", service).eq("item_id", item);
  go("/os/inventory/catalog", error, ctx.locale, "saved");
}
