import { describe, expect, it } from "vitest";
import { alertFor, csvCell, duration, historyText, messageTime, normalizeCode, parseWhatsAppWebhook, pct, periodFor, queueRank, slaState, splitList, toCsv, waLink } from "./leads-flow";

const ctwa = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "201000000000", phone_number_id: "PNID" },
    contacts: [{ profile: { name: "Mariam Adel" }, wa_id: "201001112233" }],
    messages: [{
      from: "201001112233", id: "wamid.HBg1", timestamp: "1763600520", type: "text",
      text: { body: "مرحبا GF26-LASER" },
      referral: { source_url: "https://fb.me/3abc", source_id: "120210000000001", source_type: "ad", headline: "Golden Friday",
                  body: "Laser offer", media_type: "image", image_url: "https://x", ctwa_clid: "ARAk", evil: { x: 1 } },
    }, { from: "201001112233", id: "wamid.HBg2", timestamp: "1763600530", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg" } }],
  } }] }],
});

describe("parseWhatsAppWebhook", () => {
  it("reads messages, contact name, Click-to-WhatsApp referral and media", () => {
    const { messages, statuses } = parseWhatsAppWebhook(ctwa);
    expect(statuses).toEqual([]);
    expect(messages).toHaveLength(2);
    const [m, v] = messages;
    expect(m.name).toBe("Mariam Adel");
    expect(m.text).toBe("مرحبا GF26-LASER");
    expect(m.referral?.source_id).toBe("120210000000001");
    expect(m.referral?.ctwa_clid).toBe("ARAk");
    expect((m.referral as Record<string, unknown>).evil).toBeUndefined();
    expect(v.kind).toBe("audio");
    expect(v.mediaId).toBe("MEDIA1");
    expect(v.referral).toBeNull();
    expect(historyText(v)).toContain("voice note");
  });
  it("reads delivery statuses and ignores empty payloads", () => {
    const r = parseWhatsAppWebhook(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "read" }] } }] }] }));
    expect(r.statuses).toEqual([{ id: "wamid.X", status: "read" }]);
    expect(parseWhatsAppWebhook("{}").messages).toEqual([]);
  });
  it("throws on malformed JSON", () => {
    expect(() => parseWhatsAppWebhook("not json")).toThrow();
  });
  it("converts Meta timestamps", () => {
    expect(messageTime("1763600520")).toBe("2025-11-20T01:02:00.000Z");
    expect(messageTime("abc")).toBeNull();
    expect(messageTime(undefined)).toBeNull();
  });
});

describe("SLA", () => {
  const rec = "2026-11-27T08:02:00Z";
  it("met / breached once contacted", () => {
    expect(slaState(rec, "2026-11-27T08:05:00Z", 5)).toEqual({ state: "met", seconds: 180 });
    expect(slaState(rec, "2026-11-27T08:09:00Z", 5)).toEqual({ state: "breached", seconds: 420 });
  });
  it("waiting / overdue before contact", () => {
    expect(slaState(rec, null, 5, new Date("2026-11-27T08:04:00Z")).state).toBe("waiting");
    expect(slaState(rec, null, 5, new Date("2026-11-27T08:09:00Z"))).toEqual({ state: "overdue", seconds: 420 });
  });
  it("alerts and queue order", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    const base = { first_contact_at: null, next_follow_up_at: null, last_message_at: null, last_action_at: null };
    expect(alertFor({ ...base, cc_status: "new", created_at: "2026-11-27T09:50:00Z" }, 5, now)).toBe("urgent");
    expect(alertFor({ ...base, cc_status: "new", created_at: "2026-11-27T09:58:00Z" }, 5, now)).toBeNull();
    expect(alertFor({ ...base, cc_status: "follow_up", created_at: rec, first_contact_at: rec, next_follow_up_at: "2026-11-27T09:00:00Z" }, 5, now)).toBe("followup_due");
    expect(alertFor({ ...base, cc_status: "no_response", created_at: rec, first_contact_at: rec, last_action_at: "2026-11-27T09:00:00Z", last_message_at: "2026-11-27T09:30:00Z" }, 5, now)).toBe("replied");
    expect(alertFor({ ...base, cc_status: "booked", created_at: rec, first_contact_at: rec }, 5, now)).toBe("booked");
    expect(queueRank("urgent", "new")).toBeLessThan(queueRank(null, "new"));
    expect(queueRank("followup_due", "follow_up")).toBeLessThan(queueRank("replied", "contacted"));
  });
});

describe("formatting", () => {
  it("durations", () => {
    expect(duration(180, false)).toBe("3 min");
    expect(duration(180, true)).toBe("3 د");
    expect(duration(3900, false)).toBe("1 h 05 min");
    expect(duration(2 * 86400 + 4 * 3600, false)).toBe("2 d 4 h");
    expect(duration(null, false)).toBe("—");
  });
  it("percentages", () => {
    expect(pct(6, 30)).toBe("20%");
    expect(pct(1, 3)).toBe("33.3%");
    expect(pct(1, 0)).toBe("—");
  });
  it("campaign codes and lists", () => {
    expect(normalizeCode(" gf26 laser ")).toBe("GF26-LASER");
    expect(normalizeCode("gf26__dental!!")).toBe("GF26-DENTAL");
    expect(splitList("ليزر، laser\nlaser, ")).toEqual(["ليزر", "laser"]);
  });
  it("links", () => {
    expect(waLink("+201001112233")).toBe("https://wa.me/201001112233");
    expect(waLink("+201001112233", "أهلاً")).toContain("?text=%D8%A3");
  });
  it("CSV escapes and blocks formula injection", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+201001112233")).toBe("'+201001112233");
    expect(toCsv([{ a: 1, b: null }], ["a", "b"])).toBe("﻿a,b\r\n1,\r\n");
  });
  it("period presets", () => {
    expect(periodFor("7d", "2026-11-27")).toEqual({ from: "2026-11-21", to: "2026-11-27", key: "7d" });
    expect(periodFor(undefined, "2026-11-27")).toEqual({ from: "2026-11-27", to: "2026-11-27", key: "today" });
    expect(periodFor("month", "2026-12-09")).toEqual({ from: "2026-12-01", to: "2026-12-09", key: "month" });
    expect(periodFor("yesterday", "2026-12-01").from).toBe("2026-11-30");
  });
});
