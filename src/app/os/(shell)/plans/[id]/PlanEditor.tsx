"use client";
import { useMemo, useState } from "react";

type Service = { id: string; code: string; name: string; price: number | null };
type Row = { service_id: string; tooth: string; surfaces: string; quantity: string; discount: string; lab_required: boolean; notes: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Draft plan lines. Prices shown here are a preview; the database prices every line from the price list.
export function PlanEditor({ ar, services, initial }: { ar: boolean; services: Service[]; initial: Row[] }) {
  const blank: Row = { service_id: services[0]?.id ?? "", tooth: "", surfaces: "", quantity: "1", discount: "", lab_required: false, notes: "" };
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [blank]);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const set = (n: number, patch: Partial<Row>) => setRows((r) => r.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const line = (r: Row) => Math.max(0, (byId.get(r.service_id)?.price ?? 0) * (Number(r.quantity) || 0) - (Number(r.discount) || 0));
  const total = rows.reduce((a, r) => a + line(r), 0);
  const clean = rows.filter((r) => r.service_id).map((r) => ({ service_id: r.service_id, tooth: r.tooth.trim(), surfaces: r.surfaces.trim(),
    quantity: Number(r.quantity) || 1, discount: Number(r.discount) || 0, lab_required: r.lab_required, notes: r.notes.trim() }));

  return (
    <div className="space-y-2">
      <input type="hidden" name="items" value={JSON.stringify(clean)} />
      {rows.map((r, n) => {
        const sv = byId.get(r.service_id);
        const badTooth = r.tooth !== "" && !/^([1-4][1-8]|[5-8][1-5])$/.test(r.tooth.trim());
        return (
          <div key={n} className="grid items-end gap-2 rounded-lg border border-ivory-200 p-2 sm:grid-cols-12">
            <div className="sm:col-span-4"><label className="label">{ar ? "الخدمة" : "Service"}</label>
              <select value={r.service_id} onChange={(e) => set(n, { service_id: e.target.value })} className="input" data-plan-service={n}>
                {services.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}{s.price == null ? (ar ? " (بدون سعر)" : " (no price)") : ""}</option>)}
              </select></div>
            <div className="sm:col-span-1"><label className="label">{ar ? "السن" : "Tooth"}</label>
              <input value={r.tooth} onChange={(e) => set(n, { tooth: e.target.value })} className={`input num ${badTooth ? "border-danger" : ""}`} dir="ltr" placeholder="16" data-plan-tooth={n} /></div>
            <div className="sm:col-span-1"><label className="label">{ar ? "الأسطح" : "Surf."}</label>
              <input value={r.surfaces} onChange={(e) => set(n, { surfaces: e.target.value.toUpperCase() })} className="input" dir="ltr" placeholder="MO" data-plan-surfaces={n} /></div>
            <div className="sm:col-span-1"><label className="label">{ar ? "العدد" : "Qty"}</label>
              <input type="number" min="1" step="1" value={r.quantity} onChange={(e) => set(n, { quantity: e.target.value })} className="input num" /></div>
            <div className="sm:col-span-2"><label className="label">{ar ? "خصم" : "Discount"}</label>
              <input type="number" min="0" step="0.01" value={r.discount} onChange={(e) => set(n, { discount: e.target.value })} className="input num" data-plan-discount={n} /></div>
            <label className="flex items-center gap-1 pb-2 text-xs sm:col-span-1"><input type="checkbox" checked={r.lab_required} onChange={(e) => set(n, { lab_required: e.target.checked })} data-plan-lab={n} /> {ar ? "معمل" : "Lab"}</label>
            <div className="pb-2 text-end text-sm sm:col-span-1"><span className="num">{sv?.price == null ? "—" : fmt(line(r))}</span></div>
            <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, i) => i !== n) : x))} className="h-10 text-sm text-danger sm:col-span-1" aria-label={ar ? "حذف السطر" : "Remove line"}>✕</button>
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setRows((x) => [...x, { ...blank }])} className="btn-ghost text-sm" data-add-plan-row>{ar ? "+ سطر" : "+ Line"}</button>
        <span className="text-sm text-ink-500">{ar ? "الإجمالي التقديري" : "Estimated total"}: <span className="num font-semibold text-navy-700">{fmt(total)}</span></span>
      </div>
      <p className="text-xs text-ink-300">{ar ? "ترقيم الأسنان FDI (11–48 الدائمة، 51–85 اللبنية). الأسطح: M O D B L I F P." : "FDI tooth numbers (11–48 permanent, 51–85 primary). Surfaces: M O D B L I F P."}</p>
    </div>
  );
}
