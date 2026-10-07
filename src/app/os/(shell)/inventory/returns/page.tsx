import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { decideSupplierReturn, requestSupplierReturn } from "@/app/actions/returns";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type Ret = { id: string; ref: string; status: string; total: number | null; reason: string; requested_by: string; requested_at: string; decision_note: string | null;
  supplier: { name_ar: string; name_en: string | null } | null; receipt: { supplier_invoice_no: string; ref: string } | null;
  lines: { qty: number; value: number | null; lot: { lot_no: string } | null; item: { name_ar: string; name_en: string | null; unit: string } | null }[] };

export default async function SupplierReturnsPage({ searchParams }: { searchParams: { receipt?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("inventory.receive", "purchase.approve", "purchase.read");
  const ar = ctx.locale === "ar";
  const [{ data: rets }, { data: receipts }] = await Promise.all([
    ctx.supabase.from("supplier_returns").select("id, ref, status, total, reason, requested_by, requested_at, decision_note, supplier:suppliers(name_ar, name_en), receipt:goods_receipts(supplier_invoice_no, ref), lines:supplier_return_lines(qty, value, lot:inv_lots(lot_no), item:inv_items(name_ar, name_en, unit))")
      .order("requested_at", { ascending: false }).limit(50).returns<Ret[]>(),
    ctx.can("inventory.receive") ? ctx.supabase.from("goods_receipts").select("id, ref, supplier_invoice_no, total, created_at, supplier:suppliers(name_ar, name_en)").order("created_at", { ascending: false }).limit(40)
      .returns<{ id: string; ref: string; supplier_invoice_no: string; total: number; created_at: string; supplier: { name_ar: string; name_en: string | null } | null }[]>() : Promise.resolve({ data: [] }),
  ]);
  const sel = (receipts ?? []).find((r) => r.id === searchParams.receipt);
  const { data: lots } = sel ? await ctx.supabase.from("inv_lots").select("id, lot_no, expiry, qty_on_hand, unit_cost, item:inv_items(name_ar, name_en, unit)").eq("receipt_id", sel.id).gt("qty_on_hand", 0)
    .returns<{ id: string; lot_no: string; expiry: string | null; qty_on_hand: number; unit_cost: number; item: { name_ar: string; name_en: string | null; unit: string } | null }[]>() : { data: [] };
  const approve = ctx.can("purchase.approve");
  const ok = { requested: ar ? "تم تسجيل المرتجع وينتظر الاعتماد." : "Return recorded; awaiting approval.", decided: ar ? "تم." : "Done." }[searchParams.ok ?? ""];
  const nm = (x: { name_ar: string; name_en: string | null } | null | undefined) => (ar ? x?.name_ar : x?.name_en ?? x?.name_ar) ?? "";
  return (
    <>
      <PageHeader title={ar ? "مرتجعات الموردين" : "Returns to suppliers"} subtitle={ar ? "الصنف يخرج من المخزن بتكلفة التشغيلة ويُخصم من مستحق المورد على نفس الاستلام. يسجله المخزن ويعتمده مسؤول المشتريات." : "Goods leave stock at their lot cost and reduce what is owed on that delivery. Recorded by the store, approved by purchasing."}
        actions={<Link href="/os/inventory" className="btn-ghost">{ar ? "المخزن" : "Stock"}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      {ctx.can("inventory.receive") && (
        <section className="card mb-6 space-y-3 p-4 text-sm" data-new-return>
          <form className="flex flex-wrap items-end gap-2">
            <label><span className="label">{ar ? "الاستلام (فاتورة المورد)" : "Receipt (supplier invoice)"}</span>
              <select name="receipt" defaultValue={sel?.id ?? ""} className="input min-w-72"><option value="">—</option>
                {(receipts ?? []).map((r) => <option key={r.id} value={r.id}>{nm(r.supplier)} · {r.supplier_invoice_no} · {money(r.total, ctx.locale)}</option>)}</select></label>
            <button className="btn-ghost">{ar ? "عرض الأصناف" : "Show items"}</button>
          </form>
          {sel && ((lots ?? []).length === 0 ? <p className="text-ink-500">{ar ? "لا يوجد رصيد متبقٍ من هذا الاستلام." : "Nothing left in stock from this receipt."}</p> : (
            <form action={requestSupplierReturn} className="space-y-3"><input type="hidden" name="receipt_id" value={sel.id} />
              <table className="w-full text-sm"><thead><tr><th className="th">{ar ? "الصنف" : "Item"}</th><th className="th">{ar ? "التشغيلة" : "Lot"}</th><th className="th">{ar ? "الرصيد" : "On hand"}</th><th className="th">{ar ? "التكلفة" : "Cost"}</th><th className="th">{ar ? "كمية الإرجاع" : "Return qty"}</th></tr></thead>
                <tbody className="divide-y divide-ivory-200">{(lots ?? []).map((l) => (
                  <tr key={l.id}><td className="td">{nm(l.item)}</td><td className="td num">{l.lot_no}{l.expiry ? ` · ${l.expiry}` : ""}</td><td className="td num">{l.qty_on_hand} {l.item?.unit}</td>
                    <td className="td num">{money(l.unit_cost, ctx.locale)}</td><td className="td"><input name={`qty_${l.id}`} type="number" min="0" max={l.qty_on_hand} step="0.001" defaultValue={0} className="input num w-24 py-1" /></td></tr>))}</tbody></table>
              <div className="flex flex-wrap items-end gap-2"><input name="reason" required placeholder={ar ? "السبب (تالف، خطأ في التوريد، قرب الانتهاء…)" : "Reason (damaged, wrong item, near expiry…)"} className="input w-96" />
                <SubmitButton pendingLabel="…">{ar ? "تسجيل المرتجع" : "Record return"}</SubmitButton></div>
            </form>))}
        </section>)}
      <ul className="space-y-3" data-returns>
        {(rets ?? []).length === 0 && <li className="card p-4 text-sm text-ink-300">{ctx.t("common.none")}</li>}
        {(rets ?? []).map((r) => (
          <li key={r.id} className="card p-4 text-sm" data-return={r.ref}>
            <p><span className="num font-medium text-navy-700">{r.ref}</span> · {nm(r.supplier)} · {ar ? "فاتورة" : "invoice"} <span className="num">{r.receipt?.supplier_invoice_no}</span>
              {" · "}{r.status === "requested" ? (ar ? "بانتظار الاعتماد" : "awaiting approval") : r.status === "approved" ? (ar ? "معتمد" : "approved") : (ar ? "مرفوض" : "rejected")}
              {r.total != null ? <> · <span className="num">{money(r.total, ctx.locale)}</span></> : null}</p>
            <ul className="mt-1 text-xs text-ink-500">{r.lines.map((l, i) => <li key={i}>{nm(l.item)} · <span className="num">{l.lot?.lot_no}</span> · <span className="num">{l.qty}</span> {l.item?.unit}</li>)}</ul>
            <p className="text-xs text-ink-500">{r.reason} · {dateTime(r.requested_at, ctx.locale)}{r.decision_note ? ` · ${r.decision_note}` : ""}</p>
            {r.status === "requested" && approve && (r.requested_by === ctx.user.id
              ? <p className="mt-2 text-xs text-ink-500">{ar ? "سجلته بنفسك — يعتمده مسؤول آخر." : "You recorded it — another approver decides."}</p>
              : <form action={decideSupplierReturn} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.id} />
                  <input name="note" placeholder={ar ? "ملاحظة (مطلوبة عند الرفض)" : "Note (required to reject)"} className="input w-56" />
                  <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                  <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-ghost">{ar ? "رفض" : "Reject"}</SubmitButton></form>)}
          </li>))}
      </ul>
    </>
  );
}
