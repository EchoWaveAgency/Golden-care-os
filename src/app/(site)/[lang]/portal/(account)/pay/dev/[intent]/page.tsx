import { notFound } from "next/navigation";
import { getPortal } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { money } from "@/lib/format";
import { paymentsMode } from "@/lib/payments/gateway";
import { devGatewayResult } from "@/app/actions/portal-pay";
import { SubmitButton } from "@/components/SubmitButton";

// Local payment simulator. Exists only when PAYMENTS_MODE=dev.
export default async function DevCheckout({ params }: { params: { lang: Lang; intent: string } }) {
  if (paymentsMode() !== "dev") notFound();
  const { supabase, ar, lang } = await getPortal(params.lang);
  const { data, error } = await supabase.rpc("portal_payment_status", { p_intent: params.intent });
  if (error || !data) notFound();
  const st = data as { ref: string; status: string; amount: number };
  return (
    <div className="mx-auto max-w-md rounded-2xl border-2 border-dashed border-gold-500 bg-white p-6">
      <p className="mb-4 rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-800">{ar ? "محاكي الدفع — بيئة التطوير فقط. لا يتم خصم أي أموال." : "Payment simulator — development only. No money moves."}</p>
      <p className="text-sm text-ink-500">{ar ? "المبلغ" : "Amount"}</p>
      <p className="num text-3xl font-semibold text-navy-700">{money(st.amount, lang)}</p>
      <p className="num mb-6 text-xs text-ink-300">{st.ref}</p>
      <form action={devGatewayResult} className="space-y-2">
        <input type="hidden" name="lang" value={lang} /><input type="hidden" name="intent" value={params.intent} />
        <SubmitButton name="result" value="success" pendingLabel="…" className="btn-primary w-full">{ar ? "محاكاة دفع ناجح" : "Simulate successful payment"}</SubmitButton>
        <SubmitButton name="result" value="decline" pendingLabel="…" className="btn-danger w-full">{ar ? "محاكاة رفض البطاقة" : "Simulate declined card"}</SubmitButton>
      </form>
    </div>
  );
}
