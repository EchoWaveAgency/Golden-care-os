"use client";
import { useFormState, useFormStatus } from "react-dom";
import { requestOtp, verifyOtp, type OtpState } from "@/app/actions/portal-auth";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="btn-primary w-full justify-center py-3">{pending ? "…" : label}</button>;
}

export function PortalLogin({ lang }: { lang: "ar" | "en" }) {
  const ar = lang === "ar";
  const [sent, send] = useFormState<OtpState, FormData>(requestOtp, undefined);
  const [checked, check] = useFormState<OtpState, FormData>(verifyOtp, undefined);
  const onCode = sent?.step === "code";
  const phone = sent?.phone ?? "";

  if (!onCode) {
    return (
      <form action={send} className="space-y-4">
        <input type="hidden" name="lang" value={lang} />
        <div>
          <label htmlFor="phone" className="label">{ar ? "رقم الموبايل المسجل في العيادة" : "Mobile number registered at the clinic"}</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required dir="ltr" placeholder="01xxxxxxxxx" className="input py-3 text-lg" />
        </div>
        {sent?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{sent.error}</p>}
        <Submit label={ar ? "أرسل رمز الدخول على واتساب" : "Send sign-in code on WhatsApp"} />
      </form>
    );
  }

  return (
    <form action={check} className="space-y-4">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="phone" value={phone} />
      <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">{sent?.info}</p>
      {sent?.devCode && (
        <p className="rounded-lg border border-dashed border-gold-500 px-3 py-2 text-sm text-gold-800">
          {ar ? "بيئة التطوير فقط — الرمز:" : "Development only — code:"} <span className="num font-semibold" dir="ltr">{sent.devCode}</span>
        </p>
      )}
      <div>
        <label htmlFor="code" className="label">{ar ? "رمز الدخول (6 أرقام)" : "Sign-in code (6 digits)"}</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9٠-٩]{6}" maxLength={6} required dir="ltr"
          className="input py-3 text-center text-2xl tracking-[0.5em]" />
      </div>
      {checked?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{checked.error}</p>}
      <Submit label={ar ? "دخول" : "Sign in"} />
      <button type="button" onClick={() => window.location.reload()} className="w-full text-center text-sm text-teal-700 hover:underline">
        {ar ? "تغيير الرقم أو إعادة إرسال الرمز" : "Change number or resend the code"}
      </button>
    </form>
  );
}
