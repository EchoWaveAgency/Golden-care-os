import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { requestStockTransfer, dispatchStockTransfer, receiveStockTransfer, cancelStockTransfer } from "@/app/actions/returns";

export const metadata = { title: "Stock transfers" };
export const dynamic = "force-dynamic";

type Loc = { id: string; branch_id: string; code: string; name_ar: string; name_en: string; branch: { name_ar: string; name_en: string } | null };
type T = { id: string; ref: string; status: string; from_location_id: string; to_location_id: string; from_branch_id: string; to_branch_id: string; note: string | null;
  requested_at: string; dispatched_by: string | null; value: number | null; shortage_value: number | null; receive_note: string | null; cancel_reason: string | null;
  lines: { item_id: string; qty: number }[]; lots: { id: string; item_id: string; lot_no: string; expiry: string | null; qty: number; value: number; received_qty: number | null }[] };

const STATUS: Record<string, [string, string]> = { requested: ["مطلوب — لم يُرسل", "Requested"], dispatched: ["في الطريق", "In transit"], received: ["تم الاستلام", "Received"], cancelled: ["ملغي", "Cancelled"] };

export default async function TransfersPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ctx = await requireAny("inventory.read", "inventory.manage", "inventory.receive", "inventory.issue");
  const ar = ctx.locale === "ar";
  const [{ data: locs }, { data: items }, { data: rows }] = await Promise.all([
    ctx.supabase.from("inv_locations").select("id, branch_id, code, name_ar, name_en, branch:branches(name_ar, name_en)").eq("is_active", true).order("code").returns<Loc[]>(),
    ctx.supabase.from("inv_items").select("id, code, name_ar, name_en, unit").eq("is_active", true).order("code"),
    ctx.supabase.from("stock_transfers").select("id, ref, status, from_location_id, to_location_id, from_branch_id, to_branch_id, note, requested_at, dispatched_by, value, shortage_value, receive_note, cancel_reason, lines:stock_transfer_lines(item_id, qty), lots:stock_transfer_lots(id, item_id, lot_no, expiry, qty, value, received_qty)")
      .order("requested_at", { ascending: false }).limit(40).returns<T[]>(),
  ]);
  const loc = new Map((locs ?? []).map((l) => [l.id, l]));
  const item = new Map((items ?? []).map((i) => [i.id, i]));
  const ln = (l?: Loc) => (l ? `${ar ? l.name_ar : l.name_en} — ${ar ? l.branch?.name_ar : l.branch?.name_en}` : "—");
  const it = (id: string) => { const i = item.get(id); return i ? `${i.code} · ${ar ? i.name_ar : i.name_en}` : id; };
  const ok = { requested: ar ? "تم تسجيل طلب التحويل." : "Transfer requested.", dispatched: ar ? "خرجت الأصناف من المخزن المرسل." : "Stock sent.", received: ar ? "تم الاستلام في المخزن المستلم." : "Received.", cancelled: ar ? "تم الإلغاء." : "Cancelled." }[searchParams.ok ?? ""];
  return (
    <>
      <PageHeader title={ar ? "التحويل بين المخازن والفروع" : "Transfers between stores and branches"}
        subtitle={ar ? "المخزن المرسل يصرف بالأقرب انتهاءً، والمستلم يؤكد الكمية؛ أي نقص يُسجل بملاحظة. بين الفروع تمر القيمة على «مخزون في الطريق»." : "The sender issues first-expiry-first; the receiver confirms quantities and explains any shortage. Between branches the value passes through 'inventory in transit'."}
        actions={<Link href="/os/inventory" className="btn-ghost">{ar ? "المخزن" : "Stock"}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      {ctx.can("inventory.manage") && (
        <form key={(rows ?? []).length} action={requestStockTransfer} className="card mb-6 space-y-3 p-4 text-sm" data-new-transfer>
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="label">{ar ? "من مخزن" : "From"}</span><select name="from" className="input">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{ln(l)}</option>)}</select></label>
            <label><span className="label">{ar ? "إلى مخزن" : "To"}</span><select name="to" className="input" defaultValue={(locs ?? [])[1]?.id}>{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{ln(l)}</option>)}</select></label>
            <label><span className="label">{ar ? "ملاحظة" : "Note"}</span><input name="note" className="input" /></label>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2"><select name={`item_${i}`} className="input"><option value="">—</option>{(items ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {ar ? x.name_ar : x.name_en}</option>)}</select>
                <input name={`qty_${i}`} type="number" min="0" step="0.001" className="input num w-24" aria-label={ar ? "الكمية" : "Qty"} /></div>))}
          </div>
          <SubmitButton pendingLabel="…">{ar ? "طلب تحويل" : "Request transfer"}</SubmitButton>
        </form>)}
      <ul className="space-y-3" data-transfers>
        {(rows ?? []).length === 0 && <li className="card p-4 text-sm text-ink-300">{ctx.t("common.none")}</li>}
        {(rows ?? []).map((t) => (
          <li key={t.id} className="card space-y-2 p-4 text-sm" data-transfer={t.status}>
            <p><span className="num font-medium text-navy-700">{t.ref}</span> · {ln(loc.get(t.from_location_id))} ← → {ln(loc.get(t.to_location_id))} · <span className="font-medium">{ar ? STATUS[t.status][0] : STATUS[t.status][1]}</span>
              {t.value != null && <> · <span className="num">{money(t.value, ctx.locale)}</span></>}</p>
            <p className="text-xs text-ink-500">{t.lines.map((l) => `${it(l.item_id)} × ${Number(l.qty)}`).join(" · ")} · {dateTime(t.requested_at, ctx.locale)}{t.note ? ` · ${t.note}` : ""}</p>
            {Number(t.shortage_value ?? 0) > 0 && <p className="text-xs text-warn">{ar ? "نقص" : "Shortage"} <span className="num">{money(t.shortage_value, ctx.locale)}</span> — {t.receive_note}</p>}
            {t.cancel_reason && <p className="text-xs text-ink-500">{t.cancel_reason}</p>}
            {t.status === "requested" && ctx.can("inventory.manage") && (
              <div className="flex flex-wrap gap-2">
                <form action={dispatchStockTransfer}><input type="hidden" name="id" value={t.id} /><SubmitButton pendingLabel="…" className="btn-gold">{ar ? "إرسال (صرف من المخزن)" : "Send"}</SubmitButton></form>
                <form action={cancelStockTransfer} className="flex gap-2"><input type="hidden" name="id" value={t.id} /><input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-40" />
                  <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>
              </div>)}
            {t.status === "dispatched" && (ctx.can("inventory.receive") || ctx.can("inventory.issue")) && (t.dispatched_by === ctx.user.id
              ? <p className="text-xs text-ink-500">{ar ? "أرسلته أنت — يؤكد الاستلام شخص في المخزن المستلم." : "You sent it — someone at the receiving store confirms."}</p>
              : <form action={receiveStockTransfer} className="space-y-2" data-receive-transfer><input type="hidden" name="id" value={t.id} />
                  <table className="w-full text-xs"><tbody className="divide-y divide-ivory-200">{t.lots.map((l) => (
                    <tr key={l.id}><td className="py-1">{it(l.item_id)}</td><td className="num">{l.lot_no}{l.expiry ? ` · ${l.expiry}` : ""}</td><td className="num">{ar ? "مرسل" : "sent"} {Number(l.qty)}</td>
                      <td><input name={`got_${l.id}`} type="number" min="0" max={l.qty} step="0.001" defaultValue={l.qty} className="input num w-24 py-1" aria-label={ar ? "المستلم" : "Received"} /></td></tr>))}</tbody></table>
                  <div className="flex gap-2"><input name="note" placeholder={ar ? "ملاحظة (مطلوبة لو فيه نقص)" : "Note (required if short)"} className="input" />
                    <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "تأكيد الاستلام" : "Confirm receipt"}</SubmitButton></div>
                </form>)}
          </li>))}
      </ul>
    </>
  );
}
