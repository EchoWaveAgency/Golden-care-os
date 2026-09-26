"use server";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { toWesternDigits } from "@/lib/format";

export type MfaState = { error?: string; factorId?: string; qr?: string; secret?: string } | undefined;

const msg = (ar: boolean, k: "code" | "fail") =>
  k === "code" ? (ar ? "الرمز غير صحيح أو انتهت صلاحيته. اكتب الرمز الحالي من التطبيق." : "The code is wrong or expired. Enter the current code from the app.")
               : (ar ? "تعذر إعداد التحقق الثنائي. حاول مرة أخرى." : "Could not set up two-factor sign-in. Please try again.");

// Step 1 (first time): create a TOTP factor and show its QR code / secret.
export async function startEnroll(_prev: MfaState): Promise<MfaState> {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  const { data: list } = await ctx.supabase.auth.mfa.listFactors();
  // Remove abandoned, never-verified factors so enrollment can restart cleanly.
  for (const f of list?.all ?? []) if (f.status !== "verified") await ctx.supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await ctx.supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Golden Care ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) return { error: msg(ar, "fail") };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

// Step 2 (enroll) or every sign-in (challenge): verify a 6-digit code → session becomes aal2.
export async function verifyCode(prev: MfaState, form: FormData): Promise<MfaState> {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  const code = toWesternDigits(String(form.get("code") ?? "")).replace(/\D/g, "");
  let factorId = String(form.get("factor_id") ?? "");
  if (!factorId) {
    const { data } = await ctx.supabase.auth.mfa.listFactors();
    factorId = data?.totp.find((f) => f.status === "verified")?.id ?? "";
  }
  if (!factorId || code.length !== 6) return { ...prev, error: msg(ar, "code") };
  const { error } = await ctx.supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ...prev, error: msg(ar, "code") };
  redirect("/os");
}
