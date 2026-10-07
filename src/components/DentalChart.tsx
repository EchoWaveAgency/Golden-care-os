"use client";
import { useState } from "react";
import { CONDITIONS } from "@/lib/dental-chart";

export type Chart = {
  can_write: boolean;
  teeth: Record<string, { condition: string; surfaces: string | null; note: string | null; at: string; id: string }>;
  plan: { tooth: string; surfaces: string | null; status: string; service_ar: string; service_en: string; plan: string }[];
  history: { id: string; tooth: string; condition: string; surfaces: string | null; note: string | null; at: string; voided: boolean }[];
};


const UPPER = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];
const UPPER_P = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
const LOWER_P = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

export function DentalChart({ chart, ar, action, patientId }: { chart: Chart; ar: boolean; action?: (f: FormData) => void; patientId: string }) {
  const [sel, setSel] = useState<string[]>([]);
  const [primary, setPrimary] = useState(Object.keys(chart.teeth).some((t) => Number(t[0]) >= 5) || chart.plan.some((p) => Number(p.tooth[0]) >= 5));
  const planOf = (t: string) => chart.plan.filter((p) => p.tooth === t);
  const toggle = (t: string) => chart.can_write && setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const W = 36, G = 4;
  const row = (teeth: string[], y: number, offset = 0) => teeth.map((t, i) => {
    const c = chart.teeth[t]; const st = CONDITIONS[c?.condition ?? "healthy"]; const pl = planOf(t);
    const x = offset + i * (W + G) + (i >= teeth.length / 2 ? 10 : 0);
    const chosen = sel.includes(t);
    return (
      <g key={t} transform={`translate(${x},${y})`} onClick={() => toggle(t)} style={{ cursor: chart.can_write ? "pointer" : "default" }} data-tooth={t}>
        <title>{`${t}${c ? ` — ${ar ? st.ar : st.en}${c.surfaces ? ` (${c.surfaces})` : ""}${c.note ? ` — ${c.note}` : ""}` : ""}${pl.map((p) => ` · ${ar ? p.service_ar : p.service_en} (${p.status})`).join("")}`}</title>
        <rect width={W} height={W + 6} rx={9} fill={st.fill} stroke={chosen ? "#0f5e63" : st.stroke ?? "#cfd4dc"} strokeWidth={chosen ? 3 : 1.5} />
        {c?.condition === "missing" && <path d={`M6 6 L${W - 6} ${W} M${W - 6} 6 L6 ${W}`} stroke="#98a2b3" strokeWidth={2} />}
        {c?.condition === "extraction_needed" && <path d={`M6 6 L${W - 6} ${W}`} stroke="#b42318" strokeWidth={2} />}
        <text x={W / 2} y={W / 2 + 7} textAnchor="middle" fontSize={12} fill="#1d2939" style={{ fontFamily: "inherit" }}>{t}</text>
        {pl.length > 0 && <circle cx={W - 6} cy={6} r={5} fill={pl.every((p) => p.status === "done") ? "#0f5e63" : "#c99a2e"} />}
      </g>);
  });
  const width = 16 * (W + G) + 10;
  return (
    <div className="space-y-3" data-dental-chart>
      <div className="overflow-x-auto" dir="ltr">
        <svg viewBox={`0 0 ${width} ${primary ? 230 : 120}`} className="min-w-[640px]" role="img" aria-label={ar ? "مخطط الأسنان" : "Dental chart"}>
          <text x={0} y={10} fontSize={10} fill="#667085">{ar ? "الفك العلوي — يمين المريض" : "Upper — patient's right"}</text>
          {row(UPPER, 14)}
          {row(LOWER, 72)}
          {primary && <>{row(UPPER_P, 132, 6 * (W + G))}{row(LOWER_P, 182, 6 * (W + G))}</>}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
        {Object.entries(CONDITIONS).filter(([k]) => k !== "healthy").map(([k, v]) => (
          <span key={k} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: v.fill, border: `1px solid ${v.stroke ?? "#cfd4dc"}` }} />{ar ? v.ar : v.en}</span>))}
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#c99a2e" }} />{ar ? "علاج مخطط" : "Planned work"}</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#0f5e63" }} />{ar ? "تم" : "Done"}</span>
        <label className="ms-auto flex items-center gap-1"><input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />{ar ? "إظهار الأسنان اللبنية" : "Show primary teeth"}</label>
      </div>
      {chart.can_write && action && (
        <form action={action} className="flex flex-wrap items-end gap-2 rounded-xl bg-ivory-50 p-3 text-sm" data-chart-form>
          <input type="hidden" name="patient_id" value={patientId} />
          <input type="hidden" name="teeth" value={sel.join(",")} />
          <p className="w-full text-xs text-ink-500">{sel.length ? (ar ? `الأسنان المختارة: ${sel.join("، ")}` : `Selected: ${sel.join(", ")}`) : (ar ? "اضغط على سن (أو أكثر) لتسجيل ملاحظة." : "Click one or more teeth to record a finding.")}</p>
          <label><span className="label">{ar ? "الحالة" : "Finding"}</span>
            <select name="condition" className="input">{Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></label>
          <fieldset className="flex items-center gap-1"><legend className="label">{ar ? "الأسطح" : "Surfaces"}</legend>
            {["M", "O", "D", "B", "L"].map((s) => <label key={s} className="flex items-center gap-0.5 text-xs" dir="ltr"><input type="checkbox" name="surface" value={s} />{s}</label>)}</fieldset>
          <label className="grow"><span className="label">{ar ? "ملاحظة" : "Note"}</span><input name="note" className="input" /></label>
          <button className="btn-primary" disabled={!sel.length}>{ar ? "تسجيل" : "Record"}</button>
        </form>)}
    </div>
  );
}
