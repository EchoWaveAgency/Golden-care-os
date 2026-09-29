import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PO_STATUS } from "@/lib/purchasing";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { approvePo, cancelPo, closePo, receivePo, submitPo } from "@/app/actions/purchasing";

export const dynamic = "force-dynamic";
type Po = { id: string; ref: string; status: string; total: number; created_by: string; created_at: string; expected_on: string | null; notes: string | null; cancel_reason: string | null;
  supplier: { name_ar: string; name_en: string | null } | null; location: { name_ar: string; name_en: string } | null;
  lines: { id: string; qty: number; unit_cost: number; received_qty: number; closed_short_qty: number; item: { code: string; name_ar: string; name_en: string; unit: string; category: string } }[] };

export default async function PoPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("purchase.read", "purchase.request", "purchase.approve", "inventory.receive");
  const ar = ctx.locale === "ar";
  const { data: po } = await ctx.supabase.from("purchase_orders")
    .select("id, ref, status, total, created_by, created_at, expected_on, notes, cancel_reason, supplier:suppliers(name_ar, name_en), location:inv_locations(name_ar, name_en), lines:po_lines(id, qty, unit_cost, received_qty, closed_short_qty, item:inv_items(code, name_ar, name_en, unit, category))")
    .eq("id", params.id).maybeSingle<Po>();
  if (!po) notFound();
  const { data: receipts } = await ctx.supabase.from("goods_receipts").select("id, ref, supplier_invoice_no, total, created_at").eq("po_id", po.id).order("created_at");
  const st = PO_STATUS[po.status];
  const mine = po.created_by === ctx.user.id;
  const canReceive = ["approved", "partially_received"].includes(po.status) && ctx.can("inventory.receive");
  const ok = { submitted: ar ? "أُرسل للاعتماد." : "Submitted for approval.", approved: ar ? "تم اعتماد أمر الشراء." : "Order approved.", received: ar ? "تم الاستلام على أمر الشراء." : "Received against the order.", cancelled: ar ? "تم الإلغاء." : "Cancelled.", closed: ar ? "تم إغلاق الأمر على الكميات المستلمة." : "Order closed at the received quantities." }[searchParams.ok ?? ""];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`${ar ? "أمر شراء" : "Purchase order"} ${po.ref}`}
        subtitle={`${ar ? po.supplier?.name_ar : po.supplier?.name_en ?? po.supplier?.name_ar} · ${ar ? po.location?.name_ar : po.location?.name_en}${po.expected_on ? ` · ${po.expected_on}` : ""}`}
        actions={<><StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? po.status} /><Link href="/os/purchasing" className="btn-ghost">{ctx.t("common.back")}</Link></>} />
      <Banner error={searchParams.error} success={ok} />
      <form key={`${po.status}-${searchParams.ok ?? ""}`} action={receivePo} className="card overflow-x-auto">
        <input type="hidden" name="po_id" value={po.id} />
        <input type="hidden" name="idempotency_key" value={randomUUID()} />
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-ivory-200 bg-ivory-50">
            <tr><th className="th">{ar ? "الصنف" : "Item"}</th><th className="th">{ar ? "المطلوب" : "Ordered"}</th><th className="th">{ar ? "المستلم" : "Received"}</th><th className="th">{ar ? "سعر الوحدة" : "Unit cost"}</th>
              {canReceive && <><th className="th">{ar ? "استلام الآن" : "Receive now"}</th><th className="th">{ar ? "التشغيلة" : "Lot"}</th><th className="th">{ar ? "الصلاحية" : "Expiry"}</th></>}</tr>
          </thead>
          <tbody className="divide-y divide-ivory-200">
            {po.lines.map((l) => {
              const rest = Number(l.qty) - Number(l.received_qty) - Number(l.closed_short_qty ?? 0);
              return (
                <tr key={l.id}>
                  <td className="td"><span className="num text-xs text-ink-300">{l.item.code}</span> {ar ? l.item.name_ar : l.item.name_en}</td>
                  <td className="td num">{Number(l.qty)} <span className="text-xs text-ink-300">{l.item.unit}</span></td>
                  <td className="td num">{Number(l.received_qty)}{Number(l.closed_short_qty) > 0 && <span className="block text-xs text-ink-300">{ar ? "أُغلق" : "closed"} {Number(l.closed_short_qty)}</span>}</td>
                  <td className="td num">{money(l.unit_cost, ctx.locale)}</td>
                  {canReceive && <>
                    <td className="td">{rest > 0 ? <input name={`qty_${l.id}`} type="number" min="0" max={rest} step="0.001" defaultValue={rest} className="input num w-24 py-1" aria-label={ar ? "الكمية" : "Quantity"} /> : "—"}</td>
                    <td className="td">{rest > 0 && <input name={`lot_${l.id}`} className="input w-28 py-1" dir="ltr" aria-label={ar ? "التشغيلة" : "Lot"} />}</td>
                    <td className="td">{rest > 0 && <input name={`exp_${l.id}`} type="date" className="input w-36 py-1" aria-label={ar ? "الصلاحية" : "Expiry"} />}</td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ivory-200 p-4">
          <span className="text-sm">{ar ? "الإجمالي" : "Total"}: <span className="num font-semibold text-navy-700">{money(po.total, ctx.locale)}</span></span>
          {canReceive && <span className="flex items-center gap-2"><input name="supplier_invoice_no" required placeholder={ar ? "رقم فاتورة المورد" : "Supplier invoice no."} className="input w-48" dir="ltr" />
            <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تسجيل الاستلام" : "Post receipt"}</SubmitButton></span>}
        </div>
      </form>
      {po.notes && <p className="mt-3 text-sm text-ink-500">{po.notes}</p>}
      {po.cancel_reason && <p className="mt-3 text-sm text-ink-500">{po.cancel_reason}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {po.status === "draft" && ctx.can("purchase.request") && <form action={submitPo}><input type="hidden" name="po_id" value={po.id} /><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إرسال للاعتماد" : "Submit for approval"}</SubmitButton></form>}
        {po.status === "submitted" && ctx.can("purchase.approve") && (mine
          ? <p className="text-sm text-ink-500">{ar ? "أنشأت هذا الأمر — يلزم اعتماد مسؤول آخر." : "You created this — another approver is required."}</p>
          : <form action={approvePo}><input type="hidden" name="po_id" value={po.id} /><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "اعتماد" : "Approve"}</SubmitButton></form>)}
        {["draft", "submitted", "approved"].includes(po.status) && po.lines.every((l) => Number(l.received_qty) === 0) && (ctx.can("purchase.request") || ctx.can("purchase.approve")) && (
          <form action={cancelPo} className="flex items-center gap-2"><input type="hidden" name="po_id" value={po.id} />
            <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-48" />
            <SubmitButton pendingLabel="…" className="btn-danger">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>
        )}
        {po.status === "partially_received" && (ctx.can("purchase.request") || ctx.can("purchase.approve")) && (
          <form action={closePo} className="flex items-center gap-2"><input type="hidden" name="po_id" value={po.id} />
            <input name="reason" required placeholder={ar ? "سبب إغلاق المتبقي" : "Why close the remainder"} className="input w-56" />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إغلاق بدون المتبقي" : "Close short"}</SubmitButton></form>
        )}
      </div>
      {(receipts ?? []).length > 0 && (
        <section className="mt-6"><h2 className="mb-2 font-medium text-navy-700">{ar ? "الاستلامات" : "Receipts"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">{(receipts ?? []).map((r) => <li key={r.id} className="flex justify-between px-5 py-2"><span className="num">{r.ref} · {r.supplier_invoice_no}</span><span className="num">{money(r.total, ctx.locale)} <span className="text-xs text-ink-300">{dateTime(r.created_at, ctx.locale)}</span></span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
