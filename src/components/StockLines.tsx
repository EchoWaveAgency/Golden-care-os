"use client";
import { useMemo, useState } from "react";

type Item = { id: string; code: string; name: string; unit: string; available?: number; needsExpiry?: boolean; controlled?: boolean };
type Row = { item_id: string; qty: string; lot_no?: string; expiry?: string; unit_cost?: string };

// Editable line list for goods receipts and issues. Writes the rows as JSON into a hidden "lines" field;
// the database re-validates everything (quantities, expiry, stock, permissions).
export function StockLines({ items, mode, initial, ar }: { items: Item[]; mode: "receive" | "issue"; initial?: Row[]; ar: boolean }) {
  const blank: Row = { item_id: items[0]?.id ?? "", qty: "" };
  const [rows, setRows] = useState<Row[]>(initial?.length ? initial : [blank]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const set = (n: number, patch: Partial<Row>) => setRows((r) => r.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const clean = rows.filter((r) => r.item_id && Number(r.qty) > 0).map((r) => mode === "issue"
    ? { item_id: r.item_id, qty: Number(r.qty) }
    : { item_id: r.item_id, qty: Number(r.qty), lot_no: r.lot_no ?? "", expiry: r.expiry ?? "", unit_cost: Number(r.unit_cost ?? 0) });
  const total = mode === "receive" ? rows.reduce((a, r) => a + Number(r.qty || 0) * Number(r.unit_cost || 0), 0) : 0;

  return (
    <div className="space-y-2">
      <input type="hidden" name="lines" value={JSON.stringify(clean)} />
      {rows.map((r, n) => {
        const it = byId.get(r.item_id);
        const short = mode === "issue" && it?.available !== undefined && Number(r.qty) > (it.available ?? 0);
        return (
          <div key={n} className={`grid items-end gap-2 rounded-lg border p-2 ${short ? "border-danger/40 bg-danger-50/40" : "border-ivory-200"} ${mode === "receive" ? "sm:grid-cols-12" : "sm:grid-cols-8"}`}>
            <div className={mode === "receive" ? "sm:col-span-4" : "sm:col-span-5"}>
              <label className="label">{ar ? "الصنف" : "Item"}</label>
              <select value={r.item_id} onChange={(e) => set(n, { item_id: e.target.value })} className="input" data-row-item={n}>
                {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}{i.controlled ? " ⚠" : ""}{mode === "issue" && i.available !== undefined ? ` (${i.available} ${i.unit})` : ""}</option>)}
              </select>
            </div>
            {mode === "receive" && (<>
              <div className="sm:col-span-2"><label className="label">{ar ? "رقم التشغيلة" : "Lot"}</label><input value={r.lot_no ?? ""} onChange={(e) => set(n, { lot_no: e.target.value })} className="input" dir="ltr" data-row-lot={n} /></div>
              <div className="sm:col-span-2"><label className="label">{ar ? "الصلاحية" : "Expiry"}{it?.needsExpiry ? " *" : ""}</label><input type="date" value={r.expiry ?? ""} onChange={(e) => set(n, { expiry: e.target.value })} className="input" data-row-expiry={n} /></div>
            </>)}
            <div className={mode === "receive" ? "sm:col-span-1" : "sm:col-span-2"}><label className="label">{ar ? "الكمية" : "Qty"}</label><input type="number" min="0" step="0.001" value={r.qty} onChange={(e) => set(n, { qty: e.target.value })} className="input num" data-row-qty={n} /></div>
            {mode === "receive" && <div className="sm:col-span-2"><label className="label">{ar ? "تكلفة الوحدة" : "Unit cost"}</label><input type="number" min="0" step="0.0001" value={r.unit_cost ?? ""} onChange={(e) => set(n, { unit_cost: e.target.value })} className="input num" data-row-cost={n} /></div>}
            <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, i) => i !== n) : x))} className="h-10 text-sm text-danger" aria-label={ar ? "حذف السطر" : "Remove line"}>✕</button>
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRows((x) => [...x, { ...blank }])} className="btn-ghost text-sm" data-add-row>{ar ? "+ سطر" : "+ Line"}</button>
        {mode === "receive" && <span className="text-sm text-ink-500">{ar ? "الإجمالي" : "Total"}: <span className="num font-semibold text-navy-700">{total.toFixed(2)}</span></span>}
      </div>
    </div>
  );
}
