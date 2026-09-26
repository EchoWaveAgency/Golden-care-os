"use client";
import { useFormState } from "react-dom";
import { recordPayment } from "@/app/actions/billing";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

type Method = { code: string; name: string; requires_reference: boolean };

export function PaymentForm({ invoiceId, balance, methods, idempotencyKey, l }: {
  invoiceId: string; balance: string; methods: Method[]; idempotencyKey: string; l: Record<string, string>;
}) {
  const [state, action] = useFormState(recordPayment, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <div>
        <label className="label" htmlFor="amount">{l.amount}</label>
        <input id="amount" name="amount" type="number" step="0.01" min="0.01" max={balance} defaultValue={balance} required className="input num" />
      </div>
      <div>
        <label className="label" htmlFor="method">{l.method}</label>
        <select id="method" name="method" className="input">
          {methods.map((m) => <option key={m.code} value={m.code}>{m.name}{m.requires_reference ? " *" : ""}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="reference">{l.reference}</label>
        <input id="reference" name="reference" className="input" dir="ltr" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingLabel={l.loading} className="btn-gold w-full">{l.pay}</SubmitButton>
    </form>
  );
}
