import "server-only";
import type { Ctx } from "@/lib/session";

/** Names (and phone, where the viewer may read the patient record) for a list of patients. RLS decides. */
export async function patientNames(ctx: Ctx, ids: string[]) {
  const out = new Map<string, { name: string; phone: string | null }>();
  if (!ids.length) return out;
  const { data: full } = await ctx.supabase.from("patients").select("id, first_name_ar, last_name_ar, phone").in("id", ids);
  for (const p of full ?? []) out.set(p.id, { name: `${p.first_name_ar} ${p.last_name_ar}`, phone: p.phone });
  const missing = ids.filter((i) => !out.has(i));
  if (missing.length) {
    const { data: dir } = await ctx.supabase.rpc("patient_directory", { p_ids: missing });
    for (const p of (dir ?? []) as { id: string; full_name_ar: string; phone_masked: string | null }[]) out.set(p.id, { name: p.full_name_ar, phone: p.phone_masked });
  }
  return out;
}
