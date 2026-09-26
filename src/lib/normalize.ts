import { toWesternDigits } from "./format";

// TypeScript mirrors of app.normalize_name / app.normalize_phone in the database,
// used to build search filters. The database remains the source of truth on write.

export function normalizeName(t: string | null | undefined): string {
  return (t ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(t: string | null | undefined): string | null {
  if (!t) return null;
  let d = toWesternDigits(t).replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("01")) return "+2" + d;
  if (d.length === 12 && d.startsWith("201")) return "+" + d;
  if (d.length >= 8 && d.length <= 15) return "+" + d;
  return null;
}

export type SearchKind = { kind: "mrn"; value: string } | { kind: "phone"; value: string } | { kind: "name"; value: string } | { kind: "none" };

export function classifySearch(q: string | null | undefined): SearchKind {
  const raw = toWesternDigits((q ?? "").trim());
  if (!raw) return { kind: "none" };
  if (/^p-?\d+$/i.test(raw)) {
    const digits = raw.replace(/\D/g, "");
    return { kind: "mrn", value: "P-" + digits.padStart(6, "0") };
  }
  const digits = raw.replace(/[\s\-+()]/g, "");
  if (/^\d{4,}$/.test(digits)) {
    const full = normalizePhone(digits);
    return { kind: "phone", value: full && digits.length >= 10 ? full : digits.replace(/^0/, "") };
  }
  return { kind: "name", value: normalizeName(raw) };
}
