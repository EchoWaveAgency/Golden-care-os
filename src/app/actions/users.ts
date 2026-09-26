"use server";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { adminClient } from "@/lib/server/admin";
import { supabaseServer } from "@/lib/supabase/server";

export type CreateUserState = { error?: string; email?: string; tempPassword?: string } | undefined;

function back(error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath("/os/users");
  redirect(`/os/users${error ? `?error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `?ok=${ok}` : ""}`);
}

// A readable one-time password (no ambiguous characters). Shown once to the administrator;
// the new user must replace it at first sign-in.
function tempPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

const NewUser = z.object({
  email: z.string().trim().toLowerCase().email(),
  name_ar: z.string().trim().min(2).max(120),
  name_en: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.string().min(2),
  branch_id: z.string().uuid().optional().or(z.literal("")),
  kind: z.string().optional().or(z.literal("")),
  specialty_id: z.string().uuid().optional().or(z.literal("")),
});

// Audited service-role path #4: creating a sign-in account needs the Auth admin API.
// The caller's permission is checked twice: here (session) and inside svc_admin_profile.
export async function createUser(_prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  if (!ctx.can("users.manage")) return { error: friendlyError("permission denied", ctx.locale) };
  const parsed = NewUser.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: ar ? "راجع البريد الإلكتروني والاسم والدور." : "Check the email, name and role." };
  const v = parsed.data;
  if (v.kind === "doctor" && !v.specialty_id) return { error: ar ? "اختر تخصص الطبيب." : "Choose the doctor's specialty." };

  const password = tempPassword();
  const db = adminClient();
  const created = await db.auth.admin.createUser({ email: v.email, password, email_confirm: true, user_metadata: { kind: "staff" } });
  if (created.error || !created.data.user) {
    return { error: /already|registered|exists/i.test(created.error?.message ?? "") ? (ar ? "هذا البريد مسجل بالفعل." : "This email is already registered.") : friendlyError(created.error?.message, ctx.locale) };
  }
  const uid = created.data.user.id;
  const prof = await db.rpc("svc_admin_profile", { p_actor: ctx.user.id, p_user: uid, p_name_ar: v.name_ar, p_name_en: v.name_en ?? "" });
  if (prof.error) {
    await db.auth.admin.deleteUser(uid);        // nothing else references the account yet
    return { error: friendlyError(prof.error.message, ctx.locale) };
  }
  // Staff record and first role run under the administrator's own session (RLS + audit apply).
  // The account already exists at this point, so the password is always returned; a failure
  // here is reported as a warning to finish in the list below.
  const warn = (m: string) => ({ email: v.email, tempPassword: password,
    error: (ar ? "تم إنشاء الحساب لكن لم يكتمل الإعداد: " : "Account created but setup is incomplete: ") + m });
  if (v.kind) {
    const { error } = await ctx.supabase.from("staff").insert({ user_id: uid, branch_id: v.branch_id || ctx.branchId, kind: v.kind,
      full_name_ar: v.name_ar, full_name_en: v.name_en || null, specialty_id: v.specialty_id || null });
    if (error) { revalidatePath("/os/users"); return warn(friendlyError(error.message, ctx.locale)); }
  }
  const { error } = await ctx.supabase.rpc("admin_grant_role", { p_user: uid, p_role: v.role, p_branch: v.branch_id || null, p_valid_to: null,
    p_reason: ar ? "إنشاء الحساب" : "account created" });
  revalidatePath("/os/users");
  if (error) return warn(friendlyError(error.message, ctx.locale));
  return { email: v.email, tempPassword: password };
}

export async function grantRole(form: FormData) {
  const ctx = await getContext();
  const until = String(form.get("valid_to") ?? "");
  const { error } = await ctx.supabase.rpc("admin_grant_role", {
    p_user: String(form.get("user_id")), p_role: String(form.get("role")), p_branch: String(form.get("branch_id") ?? "") || null,
    p_valid_to: until ? new Date(`${until}T23:59:00+03:00`).toISOString() : null, p_reason: String(form.get("reason") ?? ""),
  });
  back(error, ctx.locale, "granted");
}

export async function endRole(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("admin_end_role", { p_grant: String(form.get("grant_id")), p_reason: String(form.get("reason") ?? "") });
  back(error, ctx.locale, "ended");
}

export async function setActive(form: FormData) {
  const ctx = await getContext();
  const user = String(form.get("user_id"));
  const active = form.get("active") === "true";
  const { error } = await ctx.supabase.rpc("admin_set_active", { p_user: user, p_active: active, p_reason: String(form.get("reason") ?? "") });
  // After the database accepted the change (permission checked there), also block or restore sign-in
  // at the Auth level so a deactivated account cannot obtain new sessions.
  if (error) back(error, ctx.locale);
  const ban = await adminClient().auth.admin.updateUserById(user, { ban_duration: active ? "none" : "876000h" });
  if (ban.error) {
    redirect(`/os/users?error=${encodeURIComponent(ctx.locale === "ar" ? "تم تحديث الصلاحيات لكن تعذر حظر تسجيل الدخول. أعد المحاولة." : "Permissions updated, but sign-in could not be blocked. Please retry.")}`);
  }
  back(null, ctx.locale, "saved");
}

export type PasswordState = { error?: string } | undefined;

export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  const pw = String(form.get("password") ?? "");
  if (pw.length < 12 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return { error: ar ? "كلمة المرور 12 حرفًا على الأقل وتحتوي على حروف وأرقام." : "Use at least 12 characters with letters and numbers." };
  }
  if (pw !== String(form.get("confirm") ?? "")) return { error: ar ? "كلمتا المرور غير متطابقتين." : "The passwords do not match." };
  const { error } = await supabaseServer().auth.updateUser({ password: pw });
  if (error) return { error: /different|same/i.test(error.message) ? (ar ? "اختر كلمة مرور مختلفة عن المؤقتة." : "Choose a password different from the temporary one.") : friendlyError(error.message, ctx.locale) };
  // Cleared only here, after Auth accepted the new password (the flag is not user-writable).
  await adminClient().rpc("svc_password_changed", { p_user: ctx.user.id });
  redirect("/os");
}
