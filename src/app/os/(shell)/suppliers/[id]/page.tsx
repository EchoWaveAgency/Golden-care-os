import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmReceipt, decideSupplierPayment, requestSupplierPayment } from "@/app/actions/purchasing";
import { confirmSupplierBill, voidSupplierBill } from "@/app/actions/dental";

export const dynamic = "force-dynamic";
type St = {
  receipts: { id: string; ref: string; invoice_no: string; date: string; total: number; paid: number; outstanding: number; pending: number; age_days: number; po: string | null; confirmed: boolean; received_by_me: boolean; kind?: "receipt" | "bill"; bill_kind?: string | null }[];
  payments: { id: string; ref: string; amount: number; method: string; reference: string; status: string; requested_at: string; decided_at: string | null; requested_by_me: boolean }[];
  aging: { d0_30: number; d31_60: number; d61_90: number; d90p: number };
};

export default async function SupplierPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("supplier.pay.request", "supplier.pay.approve");
  const ar = ctx.locale === "ar";
  const { data: sup } = await ctx.supabase.from("suppliers").select("id, name_ar, name_en, tax_id, phone").eq("id", params.id).maybeSingle();
  if (!sup) notFound();
  const { data, error: stErr } = await ctx.supabase.rpc("supplier_statement", { p_supplier: sup.id });
  const st = (data ?? { receipts: [], payments: [], aging: { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 } }) as St;
  const open = st.receipts.filter((r) => Number(r.outstanding) - Number(r.pending) > 0);
  const canVoid = ctx.can("supplier.bill.record");
  const ok = { requested: ar ? "تم طلب الدفعة وتنتظر الصرف." : "Payment requested; awaiting release.", paid: ar ? "تم صرف الدفعة وتسجيل القيد." : "Payment released and posted.", rejected: ar ? "تم رفض الدفعة." : "Payment rejected.", confirmed: ar ? "تم تأكيد الاستلام — يمكن دفعه الآن." : "Receipt confirmed — it can now be paid.", bill_confirmed: ar ? "تم تأكيد الفاتورة — يمكن دفعها الآن." : "Bill confirmed — it can now be paid.", voided: ar ? "تم إلغاء الفاتورة وعكس قيدها." : "Bill voided and its journal reversed." }[searchParams.ok ?? ""];
  const statusLabel = (s: string) => ({ requested: ar ? "بانتظار الصرف" : "Awaiting release", paid: ar ? "مصروفة" : "Paid", rejected: ar ? "مرفوضة" : "Rejected" }[s] ?? s);

  return (
    <>
      <PageHeader title={ar ? sup.name_ar : sup.name_en ?? sup.name_ar} subtitle={[sup.tax_id, sup.phone].filter(Boolean).join(" · ")} actions={<Link href="/os/suppliers" className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error ?? (stErr ? stErr.message : undefined)} success={ok} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "حتى 30 يومًا" : "0–30 days"} value={money(st.aging.d0_30, ctx.locale)} />
        <Stat label={ar ? "31–60 يومًا" : "31–60 days"} value={money(st.aging.d31_60, ctx.locale)} tone="gold" />
        <Stat label={ar ? "61–90 يومًا" : "61–90 days"} value={money(st.aging.d61_90, ctx.locale)} tone="gold" />
        <Stat label={ar ? "أكثر من 90 يومًا" : "Over 90 days"} value={money(st.aging.d90p, ctx.locale)} tone={Number(st.aging.d90p) > 0 ? "danger" : "navy"} />
      </div>

      <form key={searchParams.ok ?? "f"} action={requestSupplierPayment} className="card overflow-x-auto">
        <input type="hidden" name="supplier_id" value={sup.id} />
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-ivory-200 bg-ivory-50">
            <tr><th className="th">{ar ? "فاتورة المورد" : "Supplier invoice"}</th><th className="th">{ar ? "التاريخ / العمر" : "Date / age"}</th><th className="th">{ar ? "الإجمالي" : "Total"}</th>
              <th className="th">{ar ? "المدفوع" : "Paid"}</th><th className="th">{ar ? "المتبقي" : "Outstanding"}</th>{ctx.can("supplier.pay.request") && <th className="th">{ar ? "يُدفع الآن" : "Pay now"}</th>}</tr>
          </thead>
          <tbody className="divide-y divide-ivory-200">
            {st.receipts.map((r) => {
              const free = Number(r.outstanding) - Number(r.pending);
              return (
                <tr key={r.id}>
                  <td className="td"><span className="num">{r.invoice_no}</span><span className="block text-xs text-ink-300 num">{r.ref}{r.po ? ` · ${r.po}` : ""}</span>
                    {r.kind === "bill" && <span className="block text-xs text-ink-500">{r.bill_kind === "lab" ? (ar ? "فاتورة معمل" : "Lab bill") : (ar ? "فاتورة صيانة" : "Maintenance bill")}</span>}
                    {!r.confirmed && <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-warn">{r.kind === "bill" ? (ar ? "غير مؤكدة — تحتاج اعتماد مسؤول" : "Unconfirmed — needs an approver") : (ar ? "غير مؤكد — استلام بدون أمر شراء" : "Unconfirmed — received without an order")}
                      {ctx.can("purchase.approve") && (r.received_by_me
                        ? <span className="text-ink-500">{ar ? "(سجّلته أنت — يؤكده مسؤول آخر)" : "(you recorded it — another approver confirms)"}</span>
                        : <button type="submit" form={`confirm-${r.id}`} data-confirm-receipt className="btn-ghost px-2 py-0.5 text-xs">{r.kind === "bill" ? (ar ? "تأكيد الفاتورة" : "Confirm bill") : (ar ? "تأكيد الاستلام" : "Confirm receipt")}</button>)}
                    </span>}
                    {r.kind === "bill" && canVoid && Number(r.paid) === 0 && Number(r.pending) === 0 && (
                      <details className="mt-1 text-xs"><summary className="cursor-pointer text-danger" data-void-bill={r.invoice_no}>{ar ? "إلغاء فاتورة خاطئة" : "Void a wrong bill"}</summary>
                        <span className="mt-1 flex flex-wrap items-center gap-2">
                          <input name="reason" form={`void-${r.id}`} required placeholder={ar ? "السبب" : "Reason"} className="input w-44 py-1 text-xs" />
                          <button type="submit" form={`void-${r.id}`} className="btn-ghost px-2 py-0.5 text-xs text-danger">{ar ? "إلغاء الفاتورة" : "Void bill"}</button>
                        </span></details>)}</td>
                  <td className="td">{dateTime(r.date, ctx.locale, { timeStyle: undefined })}<span className="block text-xs text-ink-300">{r.age_days} {ar ? "يوم" : "days"}</span></td>
                  <td className="td num">{money(r.total, ctx.locale)}</td>
                  <td className="td num">{money(r.paid, ctx.locale)}{Number(r.pending) > 0 && <span className="block text-xs text-warn">{ar ? "معلق" : "pending"} {money(r.pending, ctx.locale)}</span>}</td>
                  <td className="td num font-medium">{money(r.outstanding, ctx.locale)}</td>
                  {ctx.can("supplier.pay.request") && <td className="td">{free > 0 && r.confirmed ? <input name={r.kind === "bill" ? `payb_${r.id}` : `pay_${r.id}`} type="number" min="0" max={free} step="0.01" className="input num w-28 py-1" aria-label={ar ? "المبلغ" : "Amount"} /> : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {ctx.can("supplier.pay.request") && open.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-ivory-200 p-4">
            <div><label className="label" htmlFor="method">{ar ? "الطريقة" : "Method"}</label>
              <select id="method" name="method" className="input"><option value="bank_transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option><option value="cheque">{ar ? "شيك" : "Cheque"}</option></select></div>
            <div><label className="label" htmlFor="reference">{ar ? "رقم التحويل / الشيك" : "Transfer / cheque no."}</label><input id="reference" name="reference" required className="input" dir="ltr" /></div>
            <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "طلب الدفعة" : "Request payment"}</SubmitButton>
          </div>
        )}
      </form>

      {/* Separate forms (HTML forms cannot nest); each "confirm" button above targets one of these by id. */}
      {ctx.can("purchase.approve") && st.receipts.filter((r) => !r.confirmed && !r.received_by_me).map((r) => (
        <form key={r.id} id={`confirm-${r.id}`} action={r.kind === "bill" ? confirmSupplierBill : confirmReceipt} hidden><input type="hidden" name="supplier_id" value={sup.id} />
          <input type="hidden" name={r.kind === "bill" ? "bill_id" : "receipt_id"} value={r.id} /></form>
      ))}
      {canVoid && st.receipts.filter((r) => r.kind === "bill" && Number(r.paid) === 0 && Number(r.pending) === 0).map((r) => (
        <form key={`v-${r.id}`} id={`void-${r.id}`} action={voidSupplierBill} hidden><input type="hidden" name="supplier_id" value={sup.id} /><input type="hidden" name="bill_id" value={r.id} /></form>
      ))}

      <section className="mt-6">
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "الدفعات" : "Payments"}</h2>
        <ul className="card divide-y divide-ivory-200 text-sm">
          {st.payments.length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
          {st.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span><span className="num font-medium">{p.ref}</span> · {p.method === "cheque" ? (ar ? "شيك" : "Cheque") : (ar ? "تحويل" : "Transfer")} <span className="num">{p.reference}</span>
                <span className="block text-xs text-ink-300">{dateTime(p.requested_at, ctx.locale)} · {statusLabel(p.status)}</span></span>
              <span className="flex items-center gap-2"><span className="num font-medium">{money(p.amount, ctx.locale)}</span>
                {p.status === "requested" && ctx.can("supplier.pay.approve") && (p.requested_by_me
                  ? <span className="text-xs text-ink-500">{ar ? "طلبتها — يلزم مسؤول آخر" : "You requested — another approver needed"}</span>
                  : <form action={decideSupplierPayment} className="flex items-center gap-2"><input type="hidden" name="supplier_id" value={sup.id} /><input type="hidden" name="payment_id" value={p.id} />
                      <input name="note" placeholder={ar ? "ملاحظة (مطلوبة للرفض)" : "Note (required to reject)"} className="input w-44 py-1" />
                      <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary text-xs">{ar ? "صرف" : "Release"}</SubmitButton>
                      <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-danger text-xs">{ar ? "رفض" : "Reject"}</SubmitButton></form>)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
