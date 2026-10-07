import { redirect } from "next/navigation";
import { getPortal, INV_STATUS, type PortalFinance } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime, money } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { startPayment } from "@/app/actions/portal-pay";
import { portalReferralCode } from "@/app/actions/portal";
import { paymentsMode } from "@/lib/payments/gateway";

const METHOD: Record<string, [string, string]> = {
  online: ["دفع إلكتروني", "Online"], advance: ["من الرصيد المقدم", "From your balance"], loyalty: ["نقاط الولاء", "Loyalty points"],
  cash: ["نقدًا", "Cash"], card: ["بطاقة", "Card"], instapay: ["إنستاباي", "InstaPay"], wallet: ["محفظة إلكترونية", "Mobile wallet"], bank_transfer: ["تحويل بنكي", "Bank transfer"],
};

export default async function PortalFinancePage({ params, searchParams }: { params: { lang: Lang }; searchParams: { error?: string } }) {
  const { supabase, active, full, ar, lang } = await getPortal(params.lang);
  if (!full) redirect(`/${lang}/portal/home`);
  const { data } = await supabase.rpc("portal_finance", { p_patient: active.id });
  const f = (data ?? { balance: 0, invoices: [] }) as PortalFinance;
  const online = paymentsMode() !== "off";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "الفواتير والمدفوعات" : "Invoices & payments"}</h1>
      <Banner error={searchParams.error} />
      <div className={`rounded-2xl p-5 ${Number(f.balance) > 0 ? "bg-gold-50 text-gold-800" : "bg-teal-50 text-teal-900"}`}>
        <p className="text-sm">{ar ? "الرصيد المستحق" : "Balance due"}</p>
        <p className="num mt-1 text-3xl font-semibold">{money(f.balance, lang)}</p>
        {Number(f.balance) > 0 && <p className="mt-2 text-xs">{online ? (ar ? "ادفع أونلاين بالبطاقة أو المحفظة من زر «ادفع الآن» بجوار الفاتورة، أو في استقبال العيادة." : "Pay online by card or wallet with \u201cPay now\u201d next to the invoice, or at the clinic reception.") : (ar ? "يمكنك السداد في استقبال العيادة." : "You can pay at the clinic reception.")}</p>}
      </div>
      {(Number(f.wallet ?? 0) > 0 || f.loyalty) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Number(f.wallet ?? 0) > 0 && <div className="rounded-2xl border border-ivory-300/70 bg-white p-5" data-portal-wallet>
            <p className="text-sm text-ink-500">{ar ? "رصيدك المقدم لدى العيادة" : "Your prepaid balance"}</p>
            <p className="num mt-1 text-2xl font-semibold text-navy-700">{money(Number(f.wallet), lang)}</p>
            <p className="mt-1 text-xs text-ink-500">{ar ? "يُخصم من فواتيرك القادمة في الاستقبال." : "Used on your next invoices at reception."}</p></div>}
          {f.loyalty && <div className="rounded-2xl border border-ivory-300/70 bg-white p-5" data-portal-loyalty>
            <p className="text-sm text-ink-500">{ar ? "نقاط الولاء" : "Loyalty points"}</p>
            <p className="mt-1 text-2xl font-semibold text-navy-700"><span className="num">{f.loyalty.points}</span> <span className="text-sm font-normal text-ink-500">{ar ? "نقطة" : "points"} · <span className="num">{money(f.loyalty.value, lang)}</span></span></p>
            {f.loyalty.referral_code
              ? <p className="mt-2 text-xs text-ink-500">{ar ? "كود الدعوة الخاص بك:" : "Your invite code:"} <span className="num font-semibold text-navy-700" dir="ltr">{f.loyalty.referral_code}</span>{f.loyalty.referral_bonus ? (ar ? ` — تحصل على ${f.loyalty.referral_bonus} نقطة عن كل صديق يزورنا لأول مرة.` : ` — earn ${f.loyalty.referral_bonus} points for each friend's first visit.`) : ""}</p>
              : <form action={portalReferralCode} className="mt-2"><input type="hidden" name="lang" value={lang} /><SubmitButton pendingLabel="…" className="btn-ghost text-xs">{ar ? "اعمل كود دعوة لأصدقائك" : "Create an invite code"}</SubmitButton></form>}
          </div>}
        </div>)}
      {f.invoices.length === 0 ? <p className="rounded-2xl border border-ivory-300/70 bg-white p-6 text-sm text-ink-500">{ar ? "لا توجد فواتير." : "No invoices."}</p> : (
        <ul className="space-y-3">
          {f.invoices.map((i) => (
            <li key={i.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="num font-medium text-navy-700">{i.invoice_no}</p>
                  <p className="text-xs text-ink-500">{i.issued_at ? dateTime(i.issued_at, lang, { dateStyle: "long", timeStyle: undefined }) : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={i.status} label={(ar ? INV_STATUS[i.status]?.[0] : INV_STATUS[i.status]?.[1]) ?? i.status} />
                  {online && Number(i.balance) > 0 && ["issued", "partially_paid"].includes(i.status) && (
                    <form action={startPayment}>
                      <input type="hidden" name="lang" value={lang} /><input type="hidden" name="invoice" value={i.id} />
                      <SubmitButton pendingLabel="…" className="btn-primary text-sm">{ar ? "ادفع الآن" : "Pay now"} <span className="num">{money(i.balance, lang)}</span></SubmitButton>
                    </form>
                  )}
                </div>
              </div>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-ivory-200">
                  {(i.lines ?? []).map((l, n) => (
                    <tr key={n}><td className="py-1.5">{ar ? l.service_ar : l.service_en}{Number(l.qty) > 1 ? ` × ${l.qty}` : ""}</td><td className="num py-1.5 text-end">{money(l.net, lang)}</td></tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-ivory-300 text-ink-500">
                  {Number(i.discount) > 0 && <tr><td className="pt-2">{ar ? "الخصم" : "Discount"}</td><td className="num pt-2 text-end">{money(i.discount, lang)}</td></tr>}
                  <tr className="font-medium text-ink"><td className="pt-2">{ar ? "الإجمالي" : "Total"}</td><td className="num pt-2 text-end">{money(i.total, lang)}</td></tr>
                  <tr><td>{ar ? "المدفوع" : "Paid"}</td><td className="num text-end">{money(i.paid, lang)}</td></tr>
                  {Number(i.refunded ?? 0) > 0 && <tr className="text-teal-700"><td>{ar ? "تم رده لك" : "Refunded to you"}</td><td className="num text-end">{money(i.refunded ?? 0, lang)}</td></tr>}
                  {Number(i.balance) > 0 && <tr className="text-gold-800"><td>{ar ? "المتبقي" : "Remaining"}</td><td className="num text-end">{money(i.balance, lang)}</td></tr>}
                </tfoot>
              </table>
              {(i.receipts ?? []).length > 0 && (
                <div className="mt-3 rounded-lg bg-ivory-50 p-3 text-xs text-ink-500">
                  <p className="mb-1 font-medium">{ar ? "إيصالات السداد" : "Receipts"}</p>
                  {(i.receipts ?? []).map((r) => (
                    <p key={r.receipt_no}><span className="num">{r.receipt_no}</span> · {dateTime(r.at, lang)} · {ar ? METHOD[r.method]?.[0] : METHOD[r.method]?.[1]} · <span className="num">{money(r.amount, lang)}</span></p>
                  ))}
                  {(i.refunds ?? []).map((r) => (
                    <p key={r.ref} className="text-teal-700"><span className="num">{r.ref}</span> · {dateTime(r.at, lang)} · {ar ? "استرداد" : "Refund"} {ar ? METHOD[r.method]?.[0] : METHOD[r.method]?.[1]} · <span className="num">{money(r.amount, lang)}</span></p>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
