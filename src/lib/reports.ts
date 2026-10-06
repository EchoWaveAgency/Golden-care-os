export type ProfitRow = { service_id: string; service_code: string; service_ar: string; service_en: string; doctor_id: string | null; doctor_ar: string | null; doctor_en: string | null;
  units: number; gross: number; discounts: number; refunds: number; net_revenue: number; doctor_share: number; consumables: number; lab_costs: number; margin: number };

export function monthRange(now = new Date()): { from: string; to: string } {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
  return { from: `${d.slice(0, 7)}-01`, to: d };
}

/** Quote for CSV and neutralise spreadsheet formulas (text starting with = + - @ tab or CR is prefixed with '). */
export const esc = (v: unknown) => {
  let s = String(v ?? "");
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM so Excel opens Arabic text correctly. */
export function profitCsv(rows: ProfitRow[], lang: "ar" | "en"): string {
  const head = lang === "ar"
    ? ["الخدمة", "الكود", "الطبيب", "العدد", "الإجمالي", "الخصومات", "المرتجعات", "صافي الإيراد", "نصيب الطبيب (تقديري)", "تكلفة المستهلكات", "تكلفة المعمل", "الهامش", "نسبة الهامش %"]
    : ["Service", "Code", "Doctor", "Units", "Gross", "Discounts", "Refunds", "Net revenue", "Doctor share (est.)", "Consumables", "Lab costs", "Margin", "Margin %"];
  const lines = rows.map((r) => [lang === "ar" ? r.service_ar : r.service_en, r.service_code, (lang === "ar" ? r.doctor_ar : r.doctor_en) ?? "", Number(r.units),
    Number(r.gross), Number(r.discounts), Number(r.refunds), Number(r.net_revenue), Number(r.doctor_share), Number(r.consumables), Number(r.lab_costs ?? 0), Number(r.margin),
    Number(r.net_revenue) ? Number((Number(r.margin) / Number(r.net_revenue) * 100).toFixed(1)) : ""].map(esc).join(","));
  return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
}
