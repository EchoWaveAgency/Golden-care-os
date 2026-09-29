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

/** Saves the draft; with intent=sign, signs it right after (the database re-checks everything). */
export async function saveLaserSession(form: FormData) {
  const ctx = await getContext();
  const apt = s(form, "appointment_id");
  const back = `/os/laser/${apt}`;
  let areas: unknown = [];
  try { areas = JSON.parse(s(form, "areas") || "[]"); } catch { areas = []; }
  const checklist: Record<string, string> = {};
  for (const [k, v] of Array.from(form.entries())) if (k.startsWith("ck_")) checklist[k.slice(3)] = String(v);
  const { data, error } = await ctx.supabase.rpc("save_laser_session", {
    p_appointment: apt,
    p: {
      device_id: s(form, "device_id"), service_id: s(form, "service_id"), patient_package_id: s(form, "patient_package_id"),
      fitzpatrick: s(form, "fitzpatrick"), checklist, test_spot: form.get("test_spot") === "on", test_spot_pulses: s(form, "test_spot_pulses"),
      test_spot_note: s(form, "test_spot_note"), counter_before: s(form, "counter_before"), counter_after: s(form, "counter_after"),
      cooling: s(form, "cooling"), reaction: s(form, "reaction"), reaction_note: s(form, "reaction_note"), outcome: s(form, "outcome"),
      follow_up_on: s(form, "follow_up_on"), areas,
    },
  });
  if (error) go(back, error, ctx.locale);
  if (form.get("intent") !== "sign") go(back, null, ctx.locale, "saved");
  const { error: signErr } = await ctx.supabase.rpc("sign_laser_session", {
    p_session: (data as { id: string }).id, p_override_note: s(form, "override_note") || null,
  });
  go(back, signErr, ctx.locale, "signed");
}

export async function addLaserNote(form: FormData) {
  const ctx = await getContext();
  const apt = s(form, "appointment_id");
  const { error } = await ctx.supabase.rpc("add_laser_note", { p_session: s(form, "session_id"), p_note: s(form, "note"), p_kind: s(form, "kind") || "addendum" });
  go(`/os/laser/${apt}`, error, ctx.locale, "note");
}
