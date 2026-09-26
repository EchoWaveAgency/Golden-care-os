"use client";
import { useFormState } from "react-dom";
import { signIn } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

export function LoginForm({ labels }: { labels: { email: string; password: string; login: string; loading: string } }) {
  const [state, action] = useFormState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">{labels.email}</label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input" dir="ltr" />
      </div>
      <div>
        <label className="label" htmlFor="password">{labels.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" dir="ltr" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel={labels.loading} className="btn-primary w-full">{labels.login}</SubmitButton>
    </form>
  );
}
