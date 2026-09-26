"use client";
import { useFormState } from "react-dom";
import { closeCashierSession } from "@/app/actions/billing";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

export function CloseForm({ sessionId, l }: { sessionId: string; l: Record<string, string> }) {
  const [state, action] = useFormState(closeCashierSession, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="session_id" value={sessionId} />
      <div>
        <label className="label" htmlFor="counted">{l.counted}</label>
        <input id="counted" name="counted" type="number" step="0.01" min="0" required className="input num" />
      </div>
      <div>
        <label className="label" htmlFor="note">{l.notes}</label>
        <input id="note" name="note" className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel={l.loading} className="btn-primary w-full">{l.close}</SubmitButton>
    </form>
  );
}
