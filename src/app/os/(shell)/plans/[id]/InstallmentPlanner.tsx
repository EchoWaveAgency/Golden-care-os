"use client";
import { useState } from "react";
import { splitInstallments } from "@/lib/dental";

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Builds the installment schedule for acceptance: a down payment plus monthly installments, each row editable.
// The database refuses a schedule that does not add up to the plan total.
export function InstallmentPlanner({ ar, total, today }: { ar: boolean; total: number; today: string }) {
  const [down, setDown] = useState(String(Math.round(total * 0.4)));
  const [count, setCount] = useState("2");
  const [rows, setRows] = useState(() => splitInstallments(total, Math.round(total * 0.4), 2, today));
  const regen = (d: string, c: string) => setRows(splitInstallments(total, Number(d) || 0, Number(c) || 0, today));
  const sum = Math.round(rows.reduce((a, r) => a + r.amount * 100, 0)) / 100;
  const set = (n: number, patch: Partial<{ due_on: string; amount: number }>) => setRows((r) => r.map((x, i) => (i === n ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-3">
      <input type="hidden" name="installments" value={JSON.stringify(rows)} />
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="down">{ar ? "الدفعة المقدمة اليوم" : "Down payment today"}</label>
          <input id="down" type="number" min="0" step="0.01" value={down} onChange={(e) => { setDown(e.target.value); regen(e.target.value, count); }} className="input num w-36" /></div>
        <div><label className="label" htmlFor="count">{ar ? "عدد الأقساط الشهرية" : "Monthly installments"}</label>
          <input id="count" type="number" min="0" max="35" step="1" value={count} onChange={(e) => { setCount(e.target.value); regen(down, e.target.value); }} className="input num w-28" /></div>
      </div>
      <table className="w-full text-sm">
        <thead><tr><th className="th">#</th><th className="th">{ar ? "تاريخ الاستحقاق" : "Due"}</th><th className="th">{ar ? "المبلغ" : "Amount"}</th></tr></thead>
        <tbody className="divide-y divide-ivory-200">
          {rows.map((r, n) => (
            <tr key={n}><td className="td num">{n + 1}</td>
              <td className="td"><input type="date" value={r.due_on} min={today} onChange={(e) => set(n, { due_on: e.target.value })} className="input py-1" /></td>
              <td className="td"><input type="number" min="0.01" step="0.01" value={r.amount} onChange={(e) => set(n, { amount: Number(e.target.value) })} className="input num py-1 w-36" data-inst-amount={n} /></td></tr>
          ))}
        </tbody>
      </table>
      <p className={`rounded-lg px-3 py-2 text-sm ${sum === total ? "bg-teal-50 text-teal-900" : "bg-danger-50 text-danger"}`} data-inst-check>
        {ar ? "مجموع الأقساط" : "Schedule total"}: <span className="num font-medium">{fmt(sum)}</span> / <span className="num">{fmt(total)}</span>
        {sum === total ? (ar ? " ✓ مطابق" : " ✓ matches") : (ar ? " — يجب أن يساوي إجمالي الخطة" : " — must equal the plan total")}
      </p>
    </div>
  );
}
