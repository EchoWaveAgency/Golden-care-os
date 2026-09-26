import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "./i18n";

export type Ctx = Awaited<ReturnType<typeof loadContext>>;

const loadContext = cache(async () => {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/os/login");

  const [{ data: profile }, { data: permRows }, { data: staff }, { data: security }] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name_ar, full_name_en, locale, must_change_password").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("staff").select("id, branch_id, kind, full_name_ar, full_name_en").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("my_security"),
  ]);
  const sec = (security ?? {}) as { mfa_required?: boolean; aal?: string | null };

  const rows = (permRows ?? []) as { permission_code: string; branch_id: string | null }[];
  const perms = new Set(rows.map((r) => r.permission_code));

  // Working branch: staff branch, else first scoped grant, else the first active branch.
  let branchId: string | null = staff?.branch_id ?? rows.find((r) => r.branch_id)?.branch_id ?? null;
  if (!branchId && perms.size > 0) {
    const { data: b } = await supabase.from("branches").select("id").eq("is_active", true).order("code").limit(1).maybeSingle();
    branchId = b?.id ?? null;
  }

  const cookieLocale = cookies().get("gc_locale")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : isLocale(profile?.locale) ? profile!.locale : DEFAULT_LOCALE;

  return {
    supabase,
    user,
    profile,
    staff,
    perms,
    branchId,
    locale,
    t: translator(locale),
    can: (p: string) => perms.has(p),
    /** True when this account must use two-factor sign-in and the session has not done it yet. */
    needsMfa: Boolean(sec.mfa_required) && sec.aal !== "aal2",
  };
});

export async function getContext() {
  return loadContext();
}

/** Server-side page guard: the database enforces access too, this just gives a clean page. */
export async function requireAny(...permissions: string[]) {
  const ctx = await loadContext();
  if (!permissions.some((p) => ctx.perms.has(p))) redirect("/os?denied=1");
  return ctx;
}

export async function getLocale(): Promise<Locale> {
  const v = cookies().get("gc_locale")?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}
