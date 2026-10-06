// Treatment plans, installments and lab cases: labels and pure helpers (bilingual).

type L = { ar: string; en: string };

export const PLAN_STATUS: Record<string, L> = {
  draft: { ar: "مسودة", en: "Draft" }, proposed: { ar: "عرض سعر بانتظار الموافقة", en: "Quotation awaiting acceptance" },
  accepted: { ar: "مقبولة", en: "Accepted" }, in_progress: { ar: "قيد التنفيذ", en: "In progress" },
  completed: { ar: "مكتملة", en: "Completed" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const ITEM_STATUS: Record<string, L> = {
  planned: { ar: "مخطط", en: "Planned" }, done: { ar: "تم", en: "Done" }, cancelled: { ar: "ملغي", en: "Cancelled" },
};
export const ACCEPT_METHOD: Record<string, L> = {
  signed_paper: { ar: "توقيع على عرض السعر", en: "Signed quotation" }, in_person: { ar: "موافقة حضورية", en: "In person" }, portal: { ar: "من بوابة المريض", en: "Patient portal" },
};
export const LAB_STATUS: Record<string, L> = {
  ordered: { ar: "مطلوب", en: "Ordered" }, sent: { ar: "أُرسل للمعمل", en: "Sent to lab" }, in_lab: { ar: "في المعمل", en: "In the lab" },
  returned: { ar: "عاد من المعمل", en: "Returned" }, remake: { ar: "إعادة تصنيع", en: "Remake" }, delivered: { ar: "سُلّم للمريض", en: "Delivered" },
  cancelled: { ar: "ملغي", en: "Cancelled" },
};
/** Allowed next steps of a lab case (the database enforces the same table). */
export const LAB_NEXT: Record<string, string[]> = {
  ordered: ["sent", "cancelled"], sent: ["in_lab", "returned", "cancelled"], in_lab: ["returned", "cancelled"],
  returned: ["delivered", "remake"], remake: ["sent", "cancelled"], delivered: [], cancelled: [],
};

export const label = (m: Record<string, L>, k: string, ar: boolean) => (m[k] ? (ar ? m[k].ar : m[k].en) : k);

/** FDI tooth number (permanent 11–48, primary 51–85). */
export const isTooth = (t: string) => /^([1-4][1-8]|[5-8][1-5])$/.test(t);

const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};

/**
 * Installment schedule: an optional down payment today, then `count` monthly installments starting one month
 * later. Amounts are in whole piasters and always add up exactly to `total` (the last installment takes the rounding).
 */
export function splitInstallments(total: number, down: number, count: number, startIso: string): { due_on: string; amount: number }[] {
  const cents = Math.round(total * 100);
  const downC = Math.max(0, Math.min(cents, Math.round(down * 100)));
  const rows: { due_on: string; amount: number }[] = [];
  if (downC > 0) rows.push({ due_on: startIso, amount: downC / 100 });
  const rest = cents - downC;
  const n = Math.max(0, Math.floor(count));
  if (rest > 0 && n === 0) rows.push({ due_on: startIso, amount: rest / 100 });
  if (rest > 0 && n > 0) {
    const each = Math.floor(rest / n);
    for (let i = 1; i <= n; i++) rows.push({ due_on: addMonths(startIso, i), amount: (i === n ? rest - each * (n - 1) : each) / 100 });
  }
  return rows;
}
