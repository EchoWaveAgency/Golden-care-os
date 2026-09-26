import Link from "next/link";
import { getPortal } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { money } from "@/lib/format";

// Where the gateway sends the patient back. The status shown comes from the database,
// which is updated only by the verified server-side callback — never from URL parameters.
export default async function PayReturn({ params, searchParams }: { params: { lang: Lang }; searchParams: { intent?: string } }) {
  const { supabase, ar, lang } = await getPortal(params.lang);
  const id = searchParams.intent ?? "";
  const { data } = /^[0-9a-f-]{36}$/i.test(id) ? await supabase.rpc("portal_payment_status", { p_intent: id }) : { data: null };
  const st = data as { ref: string; status: string; amount: number; receipt_no: string | null } | null;
  const view = !st ? { tone: "bg-ivory-200 text-ink-500", title: ar ? "لم نجد عملية الدفع" : "Payment not found", body: "" }
    : st.status === "paid" ? { tone: "bg-ok-50 text-ok", title: ar ? "تم الدفع بنجاح" : "Payment successful", body: ar ? `رقم الإيصال ${st.receipt_no ?? ""}` : `Receipt ${st.receipt_no ?? ""}` }
    : st.status === "failed" ? { tone: "bg-danger-50 text-danger", title: ar ? "لم تتم عملية الدفع" : "Payment was not completed", body: ar ? "لم يُخصم أي مبلغ. يمكنك المحاولة مرة أخرى أو السداد في العيادة." : "Nothing was charged. You can try again or pay at the clinic." }
    : st.status === "review" ? { tone: "bg-warn-50 text-warn", title: ar ? "استلمنا الدفع وجارٍ مراجعته" : "Payment received — under review", body: ar ? "سيتواصل معك فريق الحسابات خلال يوم عمل." : "Our accounts team will contact you within one working day." }
    : { tone: "bg-teal-50 text-teal-900", title: ar ? "جارٍ تأكيد الدفع" : "Confirming your payment", body: ar ? "قد يستغرق التأكيد دقيقة. حدّث الصفحة بعد قليل." : "Confirmation can take a minute. Refresh this page shortly." };
  return (
    <div className="space-y-5">
      <div className={`rounded-2xl p-6 ${view.tone}`}>
        <h1 className="text-xl font-semibold">{view.title}</h1>
        {st && <p className="num mt-1 text-2xl">{money(st.amount, lang)}</p>}
        {view.body && <p className="mt-2 text-sm">{view.body}</p>}
      </div>
      <Link href={`/${lang}/portal/finance`} className="btn-primary">{ar ? "الفواتير والمدفوعات" : "Invoices & payments"}</Link>
    </div>
  );
}
