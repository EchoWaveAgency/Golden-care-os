import { redirect } from "next/navigation";
import { getPortal, INV_STATUS, type PortalFinance } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime, money } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

const METHOD: Record<string, [string, string]> = {
  cash: ["نقدًا", "Cash"], card: ["بطاقة", "Card"], instapay: ["إنستاباي", "InstaPay"], wallet: ["محفظة إلكترونية", "Mobile wallet"], bank_transfer: ["تحويل بنكي", "Bank transfer"],
};

export default async function PortalFinancePage({ params }: { params: { lang: Lang } }) {
  const { supabase, active, full, ar, lang } = await getPortal(params.lang);
  if (!full) redirect(`/${lang}/portal/home`);
  const { data } = await supabase.rpc("portal_finance", { p_patient: active.id });
  const f = (data ?? { balance: 0, invoices: [] }) as PortalFinance;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "الفواتير والمدفوعات" : "Invoices & payments"}</h1>
      <div className={`rounded-2xl p-5 ${Number(f.balance) > 0 ? "bg-gold-50 text-gold-800" : "bg-teal-50 text-teal-900"}`}>
        <p className="text-sm">{ar ? "الرصيد المستحق" : "Balance due"}</p>
        <p className="num mt-1 text-3xl font-semibold">{money(f.balance, lang)}</p>
        {Number(f.balance) > 0 && <p className="mt-2 text-xs">{ar ? "يمكنك السداد في استقبال العيادة. الدفع الإلكتروني من الحساب سيتاح قريبًا." : "You can pay at the clinic reception. Online payment from the account is coming soon."}</p>}
      </div>
      {f.invoices.length === 0 ? <p className="rounded-2xl border border-ivory-300/70 bg-white p-6 text-sm text-ink-500">{ar ? "لا توجد فواتير." : "No invoices."}</p> : (
        <ul className="space-y-3">
          {f.invoices.map((i) => (
            <li key={i.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="num font-medium text-navy-700">{i.invoice_no}</p>
                  <p className="text-xs text-ink-500">{i.issued_at ? dateTime(i.issued_at, lang, { dateStyle: "long", timeStyle: undefined }) : ""}</p>
                </div>
                <StatusBadge status={i.status} label={(ar ? INV_STATUS[i.status]?.[0] : INV_STATUS[i.status]?.[1]) ?? i.status} />
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
                  {Number(i.balance) > 0 && <tr className="text-gold-800"><td>{ar ? "المتبقي" : "Remaining"}</td><td className="num text-end">{money(i.balance, lang)}</td></tr>}
                </tfoot>
              </table>
              {(i.receipts ?? []).length > 0 && (
                <div className="mt-3 rounded-lg bg-ivory-50 p-3 text-xs text-ink-500">
                  <p className="mb-1 font-medium">{ar ? "إيصالات السداد" : "Receipts"}</p>
                  {(i.receipts ?? []).map((r) => (
                    <p key={r.receipt_no}><span className="num">{r.receipt_no}</span> · {dateTime(r.at, lang)} · {ar ? METHOD[r.method]?.[0] : METHOD[r.method]?.[1]} · <span className="num">{money(r.amount, lang)}</span></p>
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
