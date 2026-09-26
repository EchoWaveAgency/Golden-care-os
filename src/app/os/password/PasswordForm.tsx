"use client";
import { useFormState } from "react-dom";
import { changePassword, type PasswordState } from "@/app/actions/users";
import { SubmitButton } from "@/components/SubmitButton";

export function PasswordForm({ ar }: { ar: boolean }) {
  const [state, action] = useFormState<PasswordState, FormData>(changePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <div><label className="label" htmlFor="password">{ar ? "كلمة المرور الجديدة" : "New password"}</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={12} dir="ltr" className="input" /></div>
      <div><label className="label" htmlFor="confirm">{ar ? "تأكيد كلمة المرور" : "Confirm password"}</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} dir="ltr" className="input" /></div>
      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <SubmitButton pendingLabel="…" className="btn-primary w-full">{ar ? "حفظ والمتابعة" : "Save and continue"}</SubmitButton>
    </form>
  );
}
