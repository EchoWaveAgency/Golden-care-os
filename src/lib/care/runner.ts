import "server-only";
import { adminClient } from "@/lib/server/admin";
import { messagingMode, sendMessage, sendText } from "@/lib/messaging/provider";
import { step, scriptVars, urgentScript, type Ctx, type Event, type Step } from "./engine";
import { classify, safety, type Intent } from "./nlu";
import { render, type Lang } from "./scripts";
import { classifyWithModel, llmEnabled } from "./llm";
import { startCall, twiml, voiceMode, voiceUrl } from "./voice";

// Runs the care assistant: opens due conversations, answers patient replies, and plays voice calls turn by turn.
// Trusted server code with the service key (svc_* functions only). The database applies each step atomically.
//
// Order of work for every incoming message, so nothing can be lost or misread:
//   1. safety rules on the raw text (danger signs, opt-out) — before anything else;
//   2. the message is stored, and danger signs are escalated, in ONE database call;
//   3. only then the conversation logic runs. If it fails, the stored message is picked up by the sweep
//      (svc_care_sweep) and handed to a person.

type Journey = Ctx & { id: string; ref: string; version: number; phone: string; patient_id: string; branch_id: string; status: string; attempts: number };
type Db = ReturnType<typeof adminClient>;
type InboundResult = { journey?: Journey | null; message_id?: string; duplicate?: boolean; patient_id?: string | null; urgent_ref?: string | null; in_hours?: boolean };

const EXPECTED: Record<string, Intent[]> = {
  confirm: ["yes", "reschedule", "cancel", "question"], cancel_check: ["cancel", "reschedule", "keep"], identify: ["yes", "no", "later"],
  consent_q: ["yes", "later", "no"], meds: ["yes", "partly", "no"], meds_why: ["side_effects", "cost", "forgot", "text"],
  improve: ["better", "same", "worse"], problems: ["none", "complaint", "clinical", "text"], followup_offer: ["yes", "no"],
  followup_q: ["yes", "already", "not_needed"],
};

function payload(j: Journey, st: Step, inbound?: { id: string }) {
  const channel = st.channel ?? j.channel;
  const vars = scriptVars({ ...j, channel });
  const now = Date.now();
  return {
    state: st.state, status: st.status, data: st.data, outcome: st.outcome ?? null, channel,
    opened: Boolean(st.opened), nudged: Boolean(st.nudged), intent: st.intent ?? null,
    next_action_at: st.status === "waiting" ? new Date(now + (st.waitHours ?? j.nudge_after_hours ?? 4) * 3600_000).toISOString() : null,
    scheduled_at: st.status === "scheduled" ? new Date(now + (st.scheduleInHours ?? 0) * 3600_000).toISOString() : null,
    actions: st.actions,
    messages: st.say.map((s) => ({ body: render(s.key, channel, j.lang as Lang, vars), template_code: s.template ?? null, key: s.key })),
    ...(inbound ? { inbound_message_id: inbound.id } : {}),
  };
}

async function apply(db: Db, j: Journey, st: Step, inbound?: { id: string }) {
  const p = payload(j, st, inbound);
  const { data, error } = await db.rpc("svc_care_apply", { p_journey: j.id, p_version: j.version, p });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return { ids: ((data as { message_ids: string[] }).message_ids ?? []) as string[], messages: p.messages, channel: p.channel };
}

/** Sends what a step said on WhatsApp and records each result. Returns false when the opening template failed. */
async function deliver(db: Db, j: Journey, ids: string[], messages: { body: string; template_code: string | null }[]) {
  let openerFailed = false;
  for (let i = 0; i < ids.length; i++) {
    const m = messages[i];
    const r = m.template_code
      ? await sendMessage({ to: j.phone, template: m.template_code, providerTemplate: `gc_${m.template_code}`, lang: j.lang as Lang, vars: { ...scriptVars(j) }, body: m.body })
      : await sendText(j.phone, m.body);
    await db.rpc("svc_care_message_result", { p_id: ids[i], p_ok: r.ok, p_provider: r.provider, p_provider_id: r.id ?? null, p_error: r.error ?? null });
    if (!r.ok && m.template_code) openerFailed = true;
  }
  if (openerFailed) await db.rpc("svc_care_send_failed", { p_journey: j.id, p_error: "opening message failed" });
  return !openerFailed;
}

/** Optional language-model second opinion: any non-numeric reply is checked (it can add urgency, never remove it). */
async function eventFor(j: Journey, text: string): Promise<Event & { type: "text" }> {
  if (!llmEnabled() || /^\s*[\d٠-٩]\s*$/.test(text)) return { type: "text", text };
  const expected = EXPECTED[j.state] ?? [];
  const hint = await classifyWithModel(text, expected);
  if (!hint) return { type: "text", text };
  // The model's intent is used only when the rules could not understand the reply.
  const rule = classify(text, expected);
  return { type: "text", text, hint: { urgent: hint.urgent, intent: rule === "unknown" || rule === "text" ? hint.intent : undefined } };
}

async function replyTo(db: Db, inboundId: string, phone: string, lang: Lang, key: string) {
  const body = render(key, "whatsapp", lang, {});
  const { data: id } = await db.rpc("svc_care_log_reply", { p_in_message: inboundId, p_body: body });
  const res = await sendText(phone, body);
  await db.rpc("svc_care_message_result", { p_id: id, p_ok: res.ok, p_provider: res.provider, p_provider_id: res.id ?? null, p_error: res.error ?? null });
}

const langOf = (text: string, fallback: Lang = "ar"): Lang => (/[؀-ۿ]/.test(text) ? "ar" : /[a-z]/i.test(text) ? "en" : fallback);

/** One run: safety-net sweep, create due journeys, then open them or nudge the silent ones. */
export async function processDue(limit = 20, now?: Date) {
  if (messagingMode() === "disabled" && voiceMode() === "disabled") return { created: 0, opened: 0, skipped: "no provider configured" };
  const db = adminClient();
  const at = (now ?? new Date()).toISOString();
  const { data: swept } = await db.rpc("svc_care_sweep", { p_now: at });
  const { data: created } = await db.rpc("svc_care_enqueue", { p_now: at });
  const { data: batch, error } = await db.rpc("svc_care_claim", { p_limit: limit, p_now: at });
  if (error) throw new Error(error.message);
  let opened = 0, nudged = 0, calls = 0, failed = 0;
  for (const j of (batch ?? []) as Journey[]) {
    try {
      if (j.channel === "voice" && j.status === "scheduled") {
        // Record the call first (version check), then dial: a second job run can never dial the same patient.
        await apply(db, j, { state: "dialing", status: "waiting", data: j.data, say: [], actions: [], opened: true, waitHours: 1 });
        const call = await startCall(j.id, j.phone);
        if (!call.ok) { await db.rpc("svc_care_send_failed", { p_journey: j.id, p_error: call.error ?? "call failed" }); failed++; continue; }
        await db.rpc("svc_care_call_event", { p_journey: j.id, p_call_sid: call.sid ?? null, p_status: "initiated" });
        calls++; continue;
      }
      const st = step(j, { type: j.status === "scheduled" ? "open" : "nudge" });
      const r = await apply(db, j, st);
      if (r.channel === "whatsapp" && r.ids.length) { if (await deliver(db, j, r.ids, r.messages)) { if (st.opened) opened++; else nudged++; } else failed++; }
    } catch (e) {
      failed++;
      console.error(`[care] journey ${j.ref}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { swept: swept ?? 0, created: created ?? 0, opened, nudged, calls, failed };
}

/** A WhatsApp message from a patient (webhook or local simulator). Throws only if the message could not be stored. */
export async function processInbound(input: { phone: string; text: string; providerId?: string | null; kind?: "text" | "audio" | "media"; mediaId?: string | null }) {
  const db = adminClient();
  const raw = input.text ?? "";
  const text = input.kind === "audio" ? "[رسالة صوتية / voice note]" : input.kind === "media" ? `[صورة أو ملف / image or file] ${raw}`.trim() : raw;
  const s = safety(raw);

  // 1–2. Store (and escalate danger signs) in one call.
  const { data, error } = await db.rpc("svc_care_inbound", { p_phone: input.phone, p_provider_id: input.providerId ?? null, p_text: text,
    p_channel: "whatsapp", p_journey: null, p_urgent: s.urgent, p_media_id: input.mediaId ?? null });
  if (error) throw Object.assign(new Error(error.message), { stored: false });
  const r = data as InboundResult;
  if (r.duplicate) return { handled: "duplicate" };
  const msg = r.message_id!;
  const lang: Lang = r.journey ? (r.journey.lang as Lang) : langOf(raw);

  try {
    if (r.urgent_ref) {
      await replyTo(db, msg, input.phone, lang, urgentScript(s.selfHarm, r.in_hours !== false));
      return { handled: "urgent", ref: r.urgent_ref };
    }
    if (s.optOut) {
      await db.rpc("svc_care_opt_out_message", { p_message: msg });
      await replyTo(db, msg, input.phone, lang, "opted_out");
      return { handled: "opt_out" };
    }
    if (input.kind === "audio" || input.kind === "media") {
      // A person listens to / looks at it; the patient is asked to type meanwhile.
      await db.rpc("svc_care_handoff_message", { p_message: msg, p_subject: input.kind === "audio"
        ? "المريض أرسل رسالة صوتية — استمع إليها واتصل / Patient sent a voice note — listen and call back"
        : "المريض أرسل صورة أو ملفًا — راجعه / Patient sent an image or file — please review" });
      await replyTo(db, msg, input.phone, lang, input.kind === "audio" ? "no_audio" : "no_media");
      return { handled: "media" };
    }
    if (r.journey?.status === "human") {
      await db.rpc("svc_care_mark_processed", { p_message: msg });   // staff read it in the conversation
      return { handled: "staff" };
    }
    if (r.journey?.status === "waiting") {
      for (let attempt = 0; attempt < 3; attempt++) {
        const j = attempt === 0 ? r.journey : ((await db.rpc("svc_care_context", { p_journey: r.journey.id })).data as Journey);
        if (j.status !== "waiting") { await db.rpc("svc_care_mark_processed", { p_message: msg }); return { handled: "staff" }; }
        try {
          const st = step(j, await eventFor(j, raw));
          const out = await apply(db, j, st, { id: msg });
          if (out.ids.length) await deliver(db, j, out.ids, out.messages);
          return { handled: "journey", intent: st.intent, status: st.status };
        } catch (e) {
          if ((e as { code?: string }).code !== "40001" || attempt === 2) throw e;
        }
      }
    }
    // Not part of an open conversation.
    const thanks = s.thanks && raw.trim().length <= 40;
    const { data: routed } = await db.rpc("svc_care_unrouted", { p_message: msg, p_thanks: thanks });
    const action = (routed as { action: string } | null)?.action ?? "none";
    const key = thanks ? "welcome" : action === "none" ? null : "received_will_contact";
    if (key) await replyTo(db, msg, input.phone, lang, key);
    return { handled: action };
  } catch (e) {
    // The message is stored; the sweep hands it to a person if it was not processed.
    console.error(`[care] inbound ${msg}: ${e instanceof Error ? e.message : e}`);
    return { handled: "error" };
  }
}

// ---------------------------------------------------------------- Voice

async function voiceContext(db: Db, journeyId: string) {
  const { data } = await db.rpc("svc_care_context", { p_journey: journeyId });
  return data as Journey | null;
}

/** The call was answered: greet and check we are speaking to the patient. Returns TwiML. */
export async function voiceOpen(journeyId: string, answeredBy?: string | null) {
  const db = adminClient();
  const j = await voiceContext(db, journeyId);
  if (!j || j.channel !== "voice" || j.status !== "waiting" || j.state !== "dialing") return twiml([], { lang: "ar", end: true });
  if (answeredBy && answeredBy.startsWith("machine")) return twiml([], { lang: j.lang as Lang, end: true }); // no voicemail messages
  try {
    const st = step(j, { type: "open" });
    const r = await apply(db, j, st);
    return twiml(r.messages.map((m) => m.body), { lang: j.lang as Lang, listenUrl: voiceUrl("turn", j.id) });
  } catch {
    return twiml([render("handoff", "voice", j.lang as Lang, {})], { lang: j.lang as Lang, end: true });
  }
}

/** One spoken answer from the patient. Returns TwiML. */
export async function voiceTurn(journeyId: string, speech: string) {
  const db = adminClient();
  const ctx = await voiceContext(db, journeyId);
  if (!ctx || ctx.channel !== "voice" || ctx.status !== "waiting") return twiml([], { lang: "ar", end: true });
  const lang = ctx.lang as Lang;
  const s = safety(speech);
  const { data, error } = await db.rpc("svc_care_inbound", { p_phone: ctx.phone, p_provider_id: null, p_text: speech || "…",
    p_channel: "voice", p_journey: journeyId, p_urgent: s.urgent, p_media_id: null });
  if (error) return twiml([render("handoff", "voice", lang, {})], { lang, end: true });
  const r = data as InboundResult;
  if (r.urgent_ref) return twiml([render(urgentScript(s.selfHarm, r.in_hours !== false), "voice", lang, {})], { lang, end: true });
  if (s.optOut) {
    await db.rpc("svc_care_opt_out_message", { p_message: r.message_id });
    return twiml([render("opted_out", "voice", lang, {})], { lang, end: true });
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = attempt === 0 ? (r.journey ?? ctx) : ((await voiceContext(db, journeyId)) as Journey);
    try {
      const st = step(j, speech ? await eventFor(j, speech) : { type: "text", text: "" });
      const out = await apply(db, j, st, { id: r.message_id! });
      const end = st.endCall || st.status !== "waiting";
      return twiml(out.messages.map((m) => m.body), { lang, listenUrl: end ? undefined : voiceUrl("turn", j.id), end });
    } catch (e) {
      if ((e as { code?: string }).code !== "40001" || attempt === 2) break;
    }
  }
  // The stored answer is handed to a person by the sweep.
  return twiml([render("handoff", "voice", lang, {})], { lang, end: true });
}

export async function voiceStatus(journeyId: string, callSid: string | null, status: string) {
  const db = adminClient();
  const { data } = await db.rpc("svc_care_call_event", { p_journey: journeyId, p_call_sid: callSid, p_status: status });
  return data as string | null;
}
