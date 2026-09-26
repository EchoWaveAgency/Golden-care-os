"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getLocale } from "@/lib/session";
import { translator, isLocale } from "@/lib/i18n";
import type { FormState } from "@/components/FormMessage";

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const t = translator(await getLocale());
  if (!email || !password) return { error: t("auth.failed") };
  const { error } = await supabaseServer().auth.signInWithPassword({ email, password });
  if (error) return { error: t("auth.failed") };
  redirect("/");
}

export async function signOut() {
  await supabaseServer().auth.signOut();
  redirect("/login");
}

export async function setLocale(form: FormData) {
  const v = form.get("locale");
  if (isLocale(v)) {
    cookies().set("gc_locale", v, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  const back = String(form.get("back") ?? "/");
  redirect(back.startsWith("/") ? back : "/");
}
