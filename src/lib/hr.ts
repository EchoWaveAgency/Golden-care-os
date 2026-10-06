// HR helpers shared by screens and actions (pure, unit-tested).

export type PunchRow = { biometric_id: string; at: string };

const ISO_DT = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const DMY_DT = /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|ص|م)?/i;
const ID_HEADERS = ["id", "pin", "ac-no", "ac no", "acno", "user id", "userid", "emp id", "enroll", "no.", "badge", "رقم", "الكود", "كود"];

const pad = (n: string | number) => String(n).padStart(2, "0");

/** One timestamp as Cairo local "YYYY-MM-DD HH:MM:SS" (the database reads it in Cairo time). */
export function parseDateTime(text: string): string | null {
  let m = text.match(ISO_DT);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${mi}:${pad(se ?? 0)}`;
  }
  m = text.match(DMY_DT);
  if (m) {
    const [, d, mo, y, h0, mi, se, ap] = m;
    let h = Number(h0);
    if (ap && /pm|م/i.test(ap) && h < 12) h += 12;
    if (ap && /am|ص/i.test(ap) && h === 12) h = 0;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || h > 23 || +mi > 59) return null;
    return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${mi}:${pad(se ?? 0)}`;
  }
  return null;
}

/**
 * Reads a biometric export: CSV / TSV / ";" separated, with or without a header row (ZKTeco "AC-No", "ID", "PIN", …),
 * or the device log format "PIN<TAB>YYYY-MM-DD HH:MM:SS<TAB>…". Rows without an id or a time are skipped.
 */
export function parsePunchFile(text: string): { rows: PunchRow[]; skipped: number } {
  const lines = (text ?? "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], skipped: 0 };
  const sep = (l: string) => (l.includes("\t") ? "\t" : l.includes(";") && !l.includes(",") ? ";" : ",");
  const cells = (l: string) => l.split(sep(l)).map((c) => c.trim().replace(/^"|"$/g, ""));
  let idCol = -1;
  let start = 0;
  const head = cells(lines[0]).map((c) => c.toLowerCase());
  if (!parseDateTime(lines[0])) {
    idCol = head.findIndex((h) => ID_HEADERS.some((k) => h === k || h.startsWith(k)));
    start = 1;
  }
  const rows: PunchRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(start)) {
    const c = cells(line);
    const at = parseDateTime(line);
    let id = idCol >= 0 ? c[idCol] : c.find((x) => /^\d{1,12}$/.test(x) && !line.startsWith(x + "-")) ?? "";
    id = (id ?? "").replace(/^0+(?=\d)/, "");
    if (!at || !id) { skipped++; continue; }
    rows.push({ biometric_id: id, at });
  }
  return { rows, skipped };
}

export const ATT_STATUS: Record<string, { ar: string; en: string; short: string; tone: string }> = {
  present: { ar: "حاضر", en: "Present", short: "✓", tone: "bg-teal-50 text-teal-800" },
  late: { ar: "متأخر", en: "Late", short: "ت", tone: "bg-gold-100 text-navy-800" },
  absent: { ar: "غائب", en: "Absent", short: "غ", tone: "bg-danger/10 text-danger" },
  incomplete: { ar: "بصمة واحدة", en: "Single punch", short: "!", tone: "bg-gold-50 text-gold-800" },
  leave: { ar: "إجازة", en: "Leave", short: "إ", tone: "bg-navy-50 text-navy-700" },
  unpaid_leave: { ar: "إجازة بدون أجر", en: "Unpaid leave", short: "ب", tone: "bg-navy-50 text-navy-700" },
  holiday: { ar: "عطلة", en: "Holiday", short: "ع", tone: "bg-ivory-200 text-ink-500" },
  off: { ar: "راحة", en: "Day off", short: "–", tone: "bg-ivory-100 text-ink-300" },
};

export const LEAVE_STATUS: Record<string, { ar: string; en: string }> = {
  requested: { ar: "مطلوبة", en: "Requested" }, approved: { ar: "معتمدة", en: "Approved" },
  rejected: { ar: "مرفوضة", en: "Rejected" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const LOAN_STATUS: Record<string, { ar: string; en: string }> = {
  requested: { ar: "مطلوبة", en: "Requested" }, approved: { ar: "معتمدة", en: "Approved" }, disbursed: { ar: "مصروفة", en: "Paid out" },
  settled: { ar: "مسددة", en: "Settled" }, rejected: { ar: "مرفوضة", en: "Rejected" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const RUN_STATUS: Record<string, { ar: string; en: string }> = {
  prepared: { ar: "معدّة — بانتظار الاعتماد", en: "Prepared — awaiting approval" }, approved: { ar: "معتمدة — بانتظار الصرف", en: "Approved — awaiting payment" },
  paid: { ar: "مصروفة", en: "Paid" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
};
export const WEEKDAYS = [
  { n: 6, ar: "السبت", en: "Sat" }, { n: 0, ar: "الأحد", en: "Sun" }, { n: 1, ar: "الاثنين", en: "Mon" }, { n: 2, ar: "الثلاثاء", en: "Tue" },
  { n: 3, ar: "الأربعاء", en: "Wed" }, { n: 4, ar: "الخميس", en: "Thu" }, { n: 5, ar: "الجمعة", en: "Fri" },
];
export const WARNINGS: Record<string, { ar: string; en: string }> = {
  "no basic salary": { ar: "لا يوجد أجر أساسي — لم يُحسب", en: "No basic salary — not calculated" },
  "days with a single punch": { ar: "أيام ببصمة واحدة (راجع الحضور)", en: "Days with a single punch (check attendance)" },
  "net pay is negative": { ar: "صافي سالب — لا يمكن الاعتماد", en: "Negative net — cannot be approved" },
  "manual punches waiting for approval": { ar: "بصمات يدوية بانتظار الاعتماد", en: "Manual punches waiting for approval" },
  "punches from unknown biometric ids": { ar: "بصمات بأرقام غير مربوطة بموظف", en: "Punches from unknown biometric ids" },
};

export const lab = (m: Record<string, { ar: string; en: string }>, k: string | null | undefined, ar: boolean) => (k && m[k] ? (ar ? m[k].ar : m[k].en) : k ?? "");

/** "YYYY-MM" of the previous month in Cairo. */
export function lastMonth(now = new Date()): string {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(now);
  const [y, m] = d.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
export function monthDays(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${ym}-${pad(i + 1)}`);
}
/** Minutes as "1:10 h" / "35 min" (Arabic: "1:10 س" / "35 د"). */
export const minutesText = (m: number, ar: boolean) => (m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)} ${ar ? "س" : "h"}` : `${m} ${ar ? "د" : "min"}`);
