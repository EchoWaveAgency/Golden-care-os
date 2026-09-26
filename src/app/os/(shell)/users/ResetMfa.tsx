"use client";
import { useFormState } from "react-dom";
import { resetMfa, type ResetState } from "@/app/actions/users";
import { SubmitButton } from "@/components/SubmitButton";

export function ResetMfa({ userId, ar }: { userId: string; ar: boolean }) {
  const [state, action] = useFormState<ResetState, FormData>(resetMfa, undefined);
  if (state?.tempPassword) {
    return (
      <div className="w-full rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm">
        <p>{ar ? "تمت إعادة الضبط وإنهاء جلسات المستخدم. كلمة المرور المؤقتة (مرة واحدة — سلّمها شخصيًا بعد التحقق من الهوية):" : "Reset done and sessions ended. Temporary password (shown once — hand over in person after checking identity):"}</p>
        <p className="num mt-1 select-all rounded bg-white px-2 py-1 tracking-wider" dir="ltr" data-temp-password>{state.tempPassword}</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input name="reason" required placeholder={ar ? "سبب إعادة الضبط" : "Reset reason"} className="input w-40 py-1" />
      <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{ar ? "إعادة ضبط (فقد الهاتف)" : "Reset (lost phone)"}</SubmitButton>
      {state?.error && <span role="alert" className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
