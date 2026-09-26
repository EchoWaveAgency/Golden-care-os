"use client";
import { useFormState } from "react-dom";
import { startEnroll, verifyCode, type MfaState } from "@/app/actions/mfa";
import { SubmitButton } from "@/components/SubmitButton";

function CodeField({ ar }: { ar: boolean }) {
  return (
    <div>
      <label className="label" htmlFor="code">{ar ? "الرمز من تطبيق المصادقة (6 أرقام)" : "Code from your authenticator app (6 digits)"}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={6} dir="ltr"
        className="input py-3 text-center text-2xl tracking-[0.5em]" />
    </div>
  );
}

export function Challenge({ ar }: { ar: boolean }) {
  const [state, action] = useFormState<MfaState, FormData>(verifyCode, undefined);
  return (
    <form action={action} className="space-y-4">
      <CodeField ar={ar} />
      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <SubmitButton pendingLabel="…" className="btn-primary w-full">{ar ? "تأكيد" : "Verify"}</SubmitButton>
    </form>
  );
}

export function Enroll({ ar }: { ar: boolean }) {
  const [setup, begin] = useFormState<MfaState, FormData>(startEnroll, undefined);
  const [state, action] = useFormState<MfaState, FormData>(verifyCode, undefined);
  if (!setup?.factorId) {
    return (
      <form action={begin} className="space-y-4">
        <ol className="list-decimal space-y-1 ps-5 text-sm text-ink-500">
          <li>{ar ? "ثبّت تطبيق مصادقة على هاتفك (Google Authenticator أو Microsoft Authenticator)." : "Install an authenticator app on your phone (Google or Microsoft Authenticator)."}</li>
          <li>{ar ? "اضغط «ابدأ» وامسح الرمز بالتطبيق." : "Press Start and scan the code with the app."}</li>
          <li>{ar ? "اكتب الرقم الذي يظهر في التطبيق." : "Enter the number the app shows."}</li>
        </ol>
        {setup?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{setup.error}</p>}
        <SubmitButton pendingLabel="…" className="btn-primary w-full">{ar ? "ابدأ" : "Start"}</SubmitButton>
      </form>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="factor_id" value={setup.factorId} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr?.startsWith("data:") ? setup.qr : `data:image/svg+xml;utf8,${encodeURIComponent(setup.qr ?? "")}`} alt={ar ? "رمز QR لتطبيق المصادقة" : "QR code for the authenticator app"}
        width={200} height={200} className="mx-auto rounded-lg border border-ivory-300 bg-white p-2" />
      <p className="text-center text-xs text-ink-500">{ar ? "أو أدخل هذا المفتاح يدويًا:" : "Or enter this key manually:"}</p>
      <p className="num select-all break-all rounded-lg bg-ivory-100 px-3 py-2 text-center text-sm tracking-wider" dir="ltr" data-totp-secret>{setup.secret}</p>
      <CodeField ar={ar} />
      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <SubmitButton pendingLabel="…" className="btn-primary w-full">{ar ? "تفعيل" : "Activate"}</SubmitButton>
    </form>
  );
}
