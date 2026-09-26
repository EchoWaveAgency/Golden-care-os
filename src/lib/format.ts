import type { Locale } from "./i18n";

export const CLINIC_TZ = "Africa/Cairo";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Arabic-Indic digits to Western digits (storage is always Western). */
export function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

export function money(amount: number | string | null | undefined, locale: Locale, currency = "EGP"): string {
  const n = typeof amount === "string" ? Number(amount) : amount ?? 0;
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-EG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function dateTime(iso: string | Date, locale: Locale, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    timeZone: CLINIC_TZ,
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(d);
}

export function timeOnly(iso: string | Date, locale: Locale): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    timeZone: CLINIC_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** YYYY-MM-DD of "today" in the clinic timezone. */
export function clinicToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CLINIC_TZ }).format(now);
}

/** UTC offset of the clinic timezone at a given instant, e.g. "+03:00". */
export function clinicOffset(at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: CLINIC_TZ, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+02:00";
}

/** Clinic-local "YYYY-MM-DD" + "HH:MM" → ISO instant with the correct offset (handles DST). */
export function clinicLocalToIso(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const offset = clinicOffset(guess);
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

/** Postgres tstzrange literal for [start, start + minutes). */
export function slotRange(startIso: string, minutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `[${start.toISOString()},${end.toISOString()})`;
}

/** Parses the lower bound of a tstzrange string returned by PostgREST. */
export function rangeStart(range: string): string {
  const m = range.match(/^[[(]"?([^",]+)"?,/);
  if (!m) return range;
  const iso = m[1].replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? range : d.toISOString();
}
