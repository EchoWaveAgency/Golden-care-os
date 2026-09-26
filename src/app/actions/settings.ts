"use server";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { clinicToday, clinicLocalToIso } from "@/lib/format";

function back(tab: string, message?: string, ok?: string): never {
  const q = message ? `&error=${encodeURIComponent(message)}` : ok ? `&saved=1` : "";
  redirect(`/os/settings?tab=${tab}${q}`);
}

export async function saveService(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id") ?? "");
  const row = {
    code: String(form.get("code") ?? "").trim().toUpperCase(),
    specialty_id: String(form.get("specialty_id") ?? ""),
    name_ar: String(form.get("name_ar") ?? "").trim(),
    name_en: String(form.get("name_en") ?? "").trim(),
    public_visible: form.get("public_visible") === "on",
    public_show_price: form.get("public_show_price") === "on",
    online_bookable: form.get("online_bookable") === "on",
    is_active: form.get("is_active") !== "off",
  };
  if (!row.code || !row.name_ar || !row.name_en || !row.specialty_id) back("services", ctx.locale === "ar" ? "أكمل بيانات الخدمة." : "Complete the service details.");
  const { error } = id
    ? await ctx.supabase.from("services").update(row).eq("id", id)
    : await ctx.supabase.from("services").insert(row);
  if (error) back("services", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  back("services", undefined, "ok");
}

/** New price from a date: closes the current price row and opens a new one (history is kept). */
export async function setServicePrice(form: FormData) {
  const ctx = await getContext();
  const serviceId = String(form.get("service_id"));
  const price = Number(form.get("price"));
  const from = String(form.get("effective_from") || clinicToday());
  if (!Number.isFinite(price) || price < 0) back("services", ctx.locale === "ar" ? "سعر غير صحيح." : "Invalid price.");
  const { data: pl } = await ctx.supabase.from("price_lists").select("id").eq("branch_id", ctx.branchId!).eq("is_default", true).maybeSingle();
  if (!pl) back("services", ctx.locale === "ar" ? "لا توجد قائمة أسعار افتراضية للفرع." : "No default price list for this branch.");
  const { data: items } = await ctx.supabase.from("price_list_items").select("id, effective").eq("price_list_id", pl.id).eq("service_id", serviceId);
  for (const it of items ?? []) {
    const lower = String(it.effective).match(/^\[(\d{4}-\d{2}-\d{2})/)?.[1];
    const open = /,\)$/.test(String(it.effective));
    if (lower === from) {
      const { error } = await ctx.supabase.from("price_list_items").update({ price }).eq("id", it.id);
      if (error) back("services", friendlyError(error.message, ctx.locale));
      revalidatePath("/os/settings");
      back("services", undefined, "ok");
    }
    if (open && lower && lower < from) {
      const { error } = await ctx.supabase.from("price_list_items").update({ effective: `[${lower},${from})` }).eq("id", it.id);
      if (error) back("services", friendlyError(error.message, ctx.locale));
    }
  }
  const { error } = await ctx.supabase.from("price_list_items").insert({ price_list_id: pl.id, service_id: serviceId, price, effective: `[${from},)` });
  if (error) back("services", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  back("services", undefined, "ok");
}

export async function addSchedule(form: FormData) {
  const ctx = await getContext();
  const doctorId = String(form.get("doctor_id"));
  const days = form.getAll("weekday").map(Number).filter((d) => d >= 0 && d <= 6);
  const start = String(form.get("start_time")), end = String(form.get("end_time"));
  const slot = Number(form.get("slot_minutes") || 15);
  if (!days.length || !start || !end) back("schedules", ctx.locale === "ar" ? "اختر الأيام والمواعيد." : "Choose days and hours.");
  const { data: doc } = await ctx.supabase.from("staff").select("branch_id").eq("id", doctorId).single();
  const { error } = await ctx.supabase.from("doctor_schedules").insert(
    days.map((weekday) => ({ doctor_id: doctorId, branch_id: doc?.branch_id, weekday, start_time: start, end_time: end, slot_minutes: slot })),
  );
  if (error) back("schedules", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  back("schedules", undefined, "ok");
}

export async function endSchedule(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id"));
  const { data: row } = await ctx.supabase.from("doctor_schedules").select("valid_from").eq("id", id).single();
  const today = clinicToday();
  const end = row && row.valid_from > today ? row.valid_from : today;
  const { error } = await ctx.supabase.from("doctor_schedules").update({ valid_to: end }).eq("id", id);
  if (error) back("schedules", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  back("schedules", undefined, "ok");
}

export async function addException(form: FormData) {
  const ctx = await getContext();
  const doctorId = String(form.get("doctor_id") ?? "") || null;
  const from = String(form.get("from")), to = String(form.get("to"));
  const kind = String(form.get("kind"));
  if (!from || !to || to < from) back("schedules", ctx.locale === "ar" ? "راجع تواريخ الاستثناء." : "Check the exception dates.");
  const start = clinicLocalToIso(from, "00:00");
  const endIso = new Date(new Date(clinicLocalToIso(to, "00:00")).getTime() + 24 * 3600_000).toISOString();
  const { error } = await ctx.supabase.from("schedule_exceptions").insert({
    doctor_id: doctorId, branch_id: ctx.branchId, period: `[${start},${endIso})`, kind, reason: String(form.get("reason") ?? "").trim() || null,
  });
  if (error) back("schedules", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  back("schedules", undefined, "ok");
}

export async function saveSiteSetting(form: FormData) {
  const ctx = await getContext();
  const key = String(form.get("key"));
  const { error } = await ctx.supabase.from("site_settings").update({
    value_ar: String(form.get("value_ar") ?? "").trim() || null,
    value_en: String(form.get("value_en") ?? "").trim() || null,
  }).eq("key", key);
  if (error) back("site", friendlyError(error.message, ctx.locale));
  revalidatePath("/os/settings");
  revalidateTag("site");
  revalidatePath("/ar", "layout");
  revalidatePath("/en", "layout");
  back("site", undefined, "ok");
}
