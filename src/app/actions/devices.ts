"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { parseParams } from "@/lib/devices";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

export async function saveDevice(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const payload = {
    id, branch_id: s(form, "branch_id") || ctx.branchId, asset_no: s(form, "asset_no"), name_ar: s(form, "name_ar"), name_en: s(form, "name_en"),
    category: s(form, "category"), room_id: s(form, "room_id"), manufacturer: s(form, "manufacturer"), model: s(form, "model"),
    serial_no: s(form, "serial_no"), supplier_id: s(form, "supplier_id"), purchase_date: s(form, "purchase_date"), purchase_cost: s(form, "purchase_cost"),
    warranty_until: s(form, "warranty_until"), counter_unit: s(form, "counter_unit"), counter_value: s(form, "counter_value"),
    expected_life: s(form, "expected_life"), service_every: s(form, "service_every"), pm_interval_days: s(form, "pm_interval_days"),
    calibration_interval_days: s(form, "calibration_interval_days"), notes: s(form, "notes"),
    params: parseParams({ wavelengths: s(form, "p_wavelengths"), spots: s(form, "p_spots"), fluence: s(form, "p_fluence"), pulse: s(form, "p_pulse") }),
  };
  const { data, error } = await ctx.supabase.rpc("save_device", { p: payload });
  if (error) go(id ? `/os/devices/${id}` : "/os/devices?new=1", error, ctx.locale);
  go(`/os/devices/${(data as { id: string }).id}`, null, ctx.locale, id ? "saved" : "created");
}

export async function retireDevice(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "device_id");
  const { error } = await ctx.supabase.rpc("retire_device", { p_device: id, p_reason: s(form, "reason") });
  go(`/os/devices/${id}`, error, ctx.locale, "retired");
}

export async function recordReading(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "device_id");
  if (!/^\d+$/.test(s(form, "reading"))) go(`/os/devices/${id}`, { message: "reading is required" }, ctx.locale);
  const { error } = await ctx.supabase.rpc("record_counter_reading", {
    p_device: id, p_reading: Number(s(form, "reading")), p_note: s(form, "note") || null, p_reset: form.get("reset") === "on",
  });
  go(`/os/devices/${id}`, error, ctx.locale, "reading");
}

export async function openWorkOrder(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "device_id");
  const { error } = await ctx.supabase.rpc("open_work_order", {
    p_device: id, p_kind: s(form, "kind"), p_problem: s(form, "problem"), p_device_down: form.get("device_down") === "on",
  });
  go(`/os/devices/${id}`, error, ctx.locale, "opened");
}

export async function closeWorkOrder(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "device_id");
  const passed = s(form, "passed");
  const { error } = await ctx.supabase.rpc("close_work_order", {
    p_order: s(form, "order_id"),
    p: { result: s(form, "result"), technician: s(form, "technician"), vendor_id: s(form, "vendor_id"), parts: s(form, "parts"),
      parts_cost: s(form, "parts_cost"), labor_cost: s(form, "labor_cost"), counter_reading: s(form, "counter_reading"),
      passed: passed === "" ? null : passed === "yes" },
  });
  go(`/os/devices/${id}`, error, ctx.locale, "closed");
}

export async function cancelWorkOrder(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "device_id");
  const { error } = await ctx.supabase.rpc("cancel_work_order", { p_order: s(form, "order_id"), p_reason: s(form, "reason") });
  go(`/os/devices/${id}`, error, ctx.locale, "cancelled");
}
