import "server-only";
import type { Ctx } from "./session";

export type Loc = { id: string; branch_id: string; code: string; name_ar: string; name_en: string };

/** Active stores, the user's own branch first; `wanted` selects one if it exists. */
export async function storesFor(ctx: Ctx, wanted?: string) {
  const { data } = await ctx.supabase.from("inv_locations").select("id, branch_id, code, name_ar, name_en").eq("is_active", true).order("code").returns<Loc[]>();
  const list = (data ?? []).sort((a, b) => Number(b.branch_id === ctx.branchId) - Number(a.branch_id === ctx.branchId));
  const current = list.find((l) => l.id === wanted) ?? list[0] ?? null;
  return { list, current };
}

export const CATEGORY: Record<string, [string, string]> = {
  consumable: ["مستهلكات", "Consumables"], drug: ["أدوية", "Medicines"], laser_part: ["قطع أجهزة الليزر", "Laser parts"],
  dental_material: ["خامات الأسنان", "Dental materials"], cosmetic: ["مستحضرات تجميل", "Cosmetics"], other: ["أخرى", "Other"],
};
