// Golden Friday lead flow: pure helpers shared by the webhook, the call-center pages and reports.
// No I/O here — everything is unit-tested in leads-flow.test.ts.

export const CC_STATUSES = ["new", "contacted", "interested", "not_interested", "no_response", "follow_up", "booked", "closed"] as const;
export type CcStatus = (typeof CC_STATUSES)[number];

export const CC_STATUS: Record<CcStatus, { ar: string; en: string; tone: string }> = {
  new:            { ar: "جديد",          en: "NEW",            tone: "bg-gold-500 text-coal-950" },
  contacted:      { ar: "تم التواصل",    en: "CONTACTED",      tone: "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40" },
  interested:     { ar: "مهتم",          en: "INTERESTED",     tone: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/40" },
  not_interested: { ar: "غير مهتم",      en: "NOT INTERESTED", tone: "bg-coal-600 text-ivory-300" },
  no_response:    { ar: "لا يرد",        en: "NO RESPONSE",    tone: "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/40" },
  follow_up:      { ar: "متابعة",        en: "FOLLOW-UP",      tone: "bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40" },
  booked:         { ar: "تم الحجز",      en: "BOOKED",         tone: "bg-emerald-500 text-coal-950" },
  closed:         { ar: "مغلق",          en: "CLOSED",         tone: "bg-coal-600 text-ivory-300" },
};

export const SOURCES = ["meta", "facebook", "instagram", "whatsapp", "organic", "manual", "other"] as const;
export const SOURCE: Record<string, { ar: string; en: string }> = {
  meta: { ar: "ميتا (إعلان)", en: "Meta ad" }, facebook: { ar: "فيسبوك", en: "Facebook" }, instagram: { ar: "إنستجرام", en: "Instagram" },
  whatsapp: { ar: "واتساب مباشر", en: "WhatsApp direct" }, organic: { ar: "الموقع / عضوي", en: "Website / organic" },
  manual: { ar: "إدخال يدوي", en: "Manual" }, other: { ar: "أخرى", en: "Other" },
};

/** Actions that need extra input (form) vs one tap. */
export const NEEDS_FORM: CcStatus[] = ["follow_up", "booked", "not_interested", "closed"];
export const QUICK: CcStatus[] = ["contacted", "interested", "no_response"];
export const OPEN_STATUSES: CcStatus[] = ["new", "contacted", "interested", "no_response", "follow_up"];

// ---------------------------------------------------------------- WhatsApp Cloud API webhook

export type Referral = {
  source_url?: string; source_id?: string; source_type?: string; headline?: string; body?: string;
  media_type?: string; image_url?: string; video_url?: string; thumbnail_url?: string; ctwa_clid?: string;
};
export type InboundMessage = {
  from: string; id: string; type: string; timestamp?: string; name: string | null; referral: Referral | null;
  text: string; kind: "text" | "audio" | "media"; mediaId: string | null;
};
export type StatusUpdate = { id: string; status: string };

type RawMessage = {
  from: string; id: string; type: string; timestamp?: string; referral?: Referral;
  text?: { body?: string }; button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  audio?: { id?: string }; voice?: { id?: string }; image?: { id?: string; caption?: string }; document?: { id?: string; caption?: string };
  video?: { id?: string; caption?: string }; sticker?: { id?: string };
};
type RawValue = { statuses?: StatusUpdate[]; messages?: RawMessage[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] };

/** Parses a Meta webhook body. Throws on malformed JSON (caller answers 400). */
export function parseWhatsAppWebhook(raw: string): { statuses: StatusUpdate[]; messages: InboundMessage[] } {
  const body = JSON.parse(raw) as { entry?: { changes?: { value?: RawValue }[] }[] };
  const values = (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value ?? {}));
  const names = new Map<string, string>();
  for (const v of values) for (const c of v.contacts ?? []) if (c.wa_id && c.profile?.name) names.set(c.wa_id, c.profile.name);
  const statuses = values.flatMap((v) => v.statuses ?? []);
  const messages = values.flatMap((v) => v.messages ?? []).filter((m) => m && m.from && m.id).map((m): InboundMessage => {
    const media = m.audio ?? m.voice ?? m.image ?? m.document ?? m.video ?? m.sticker;
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
      ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? "";
    const kind = m.type === "audio" || m.type === "voice" ? "audio" : ["image", "document", "video", "sticker"].includes(m.type) ? "media" : "text";
    const referral = m.referral && typeof m.referral === "object" ? cleanReferral(m.referral) : null;
    return { from: m.from, id: m.id, type: m.type, timestamp: m.timestamp, name: names.get(m.from) ?? null, referral, text, kind, mediaId: media?.id ?? null };
  });
  return { statuses, messages };
}

function cleanReferral(r: Referral): Referral {
  const keys: (keyof Referral)[] = ["source_url", "source_id", "source_type", "headline", "body", "media_type", "image_url", "video_url", "thumbnail_url", "ctwa_clid"];
  const out: Referral = {};
  for (const k of keys) { const v = r[k]; if (typeof v === "string" && v) out[k] = v.slice(0, 1000); }
  return out;
}

/** Meta sends unix seconds. */
export function messageTime(ts?: string): string | null {
  if (!ts || !/^\d{9,11}$/.test(ts)) return null;
  return new Date(Number(ts) * 1000).toISOString();
}

/** Text stored for the lead history (voice notes / images have no text). */
export function historyText(m: Pick<InboundMessage, "kind" | "text">): string {
  if (m.kind === "audio") return "[رسالة صوتية / voice note]";
  if (m.kind === "media") return `[صورة أو ملف / image or file] ${m.text}`.trim();
  return m.text;
}

// ---------------------------------------------------------------- SLA and time

export type SlaState = { state: "met" | "breached" | "waiting" | "overdue"; seconds: number };

/** Response SLA for one lead. Waiting = not contacted yet and still inside the window. */
export function slaState(receivedAt: string, firstContactAt: string | null, slaMinutes: number, now: Date = new Date()): SlaState {
  const start = new Date(receivedAt).getTime();
  if (firstContactAt) {
    const s = Math.max(0, Math.round((new Date(firstContactAt).getTime() - start) / 1000));
    return { state: s <= slaMinutes * 60 ? "met" : "breached", seconds: s };
  }
  const s = Math.max(0, Math.round((now.getTime() - start) / 1000));
  return { state: s > slaMinutes * 60 ? "overdue" : "waiting", seconds: s };
}

/** "3 min", "1 h 05 min", "2 d 4 h" — compact, bilingual. */
export function duration(seconds: number | null | undefined, ar: boolean): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return ar ? `${s} ث` : `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return ar ? `${m} د` : `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return ar ? `${h} س ${String(mm).padStart(2, "0")} د` : `${h} h ${String(mm).padStart(2, "0")} min`;
  const d = Math.floor(h / 24), hh = h % 24;
  return ar ? `${d} يوم ${hh} س` : `${d} d ${hh} h`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((1000 * part) / whole) / 10}%`;
}

/** Alert level for the queue: urgent (SLA), follow-up due, customer replied, booked. */
export type Alert = "urgent" | "followup_due" | "replied" | "booked" | null;
export function alertFor(l: { cc_status: string; created_at: string; first_contact_at: string | null; next_follow_up_at: string | null;
  last_message_at: string | null; last_action_at: string | null }, slaMinutes: number, now: Date = new Date()): Alert {
  if (l.cc_status === "new" && !l.first_contact_at && now.getTime() - new Date(l.created_at).getTime() > slaMinutes * 60_000) return "urgent";
  if (l.cc_status === "follow_up" && l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() <= now.getTime()) return "followup_due";
  if (l.last_message_at && l.last_action_at && new Date(l.last_message_at) > new Date(l.last_action_at)
      && !["booked", "closed", "not_interested"].includes(l.cc_status)) return "replied";
  if (l.cc_status === "booked") return "booked";
  return null;
}

/** Sort for the agent queue: urgent first (oldest first), then due follow-ups, replied, new, the rest by recency. */
export function queueRank(a: Alert, status: string): number {
  if (a === "urgent") return 0;
  if (a === "followup_due") return 1;
  if (a === "replied") return 2;
  if (status === "new") return 3;
  if (status === "follow_up") return 5;
  if (status === "booked") return 7;
  return 4;
}

// ---------------------------------------------------------------- Phone, links, CSV

/** wa.me / tel links for an E.164 number stored as +20… */
export function waLink(phone: string, text?: string): string {
  const d = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
export function telLink(phone: string): string { return `tel:${phone.replace(/[^0-9+]/g, "")}`; }

/** Campaign codes accept what people type: "gf26 laser" → "GF26-LASER". */
export function normalizeCode(s: string): string {
  return s.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/[^A-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
export function splitList(s: string): string[] {
  return Array.from(new Set(s.split(/[,،\n]/).map((x) => x.trim()).filter(Boolean)));
}

export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** Cairo date range presets for the control page. */
export function periodFor(key: string | undefined, today: string): { from: string; to: string; key: string } {
  const d = (n: number) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  switch (key) {
    case "yesterday": return { from: d(-1), to: d(-1), key };
    case "7d": return { from: d(-6), to: today, key };
    case "30d": return { from: d(-29), to: today, key };
    default: return { from: today, to: today, key: "today" };
  }
}
