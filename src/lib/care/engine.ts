// The care assistant's conversation logic. Pure: given the journey context and one event, it returns the next state,
// what to say, and what the database should do. No I/O here, so every path is unit-tested.
import { classify, ratingOf, safety, type Intent } from "./nlu";
import { TEMPLATE_FOR, type Channel, type Lang } from "./scripts";

export type Kind = "booking_confirm" | "pre_visit" | "post_visit" | "followup";
export type Ctx = {
  kind: Kind; channel: Channel; lang: Lang; state: string; data: Record<string, unknown>; status: string;
  name: string; name_en?: string; doctor?: string | null; doctor_en?: string | null; date?: string | null; time?: string | null;
  has_rx?: boolean; followup_due?: string | null; clinic_phone?: string | null; appointment_status?: string | null;
  nudges: number; max_nudges: number; nudge_after_hours: number; voice_enabled?: boolean; voice_fallback?: boolean;
  last_inbound_at?: string | null; in_hours?: boolean; cancel_allowed?: boolean;
};
export type Event = { type: "open" } | { type: "nudge" } | { type: "text"; text: string; hint?: Hint };
/** Optional extra understanding (language model). It can raise urgency, never lower it. */
export type Hint = { intent?: Intent; urgent?: boolean };

export type Action =
  | { type: "confirm_appointment" } | { type: "cancel_appointment" }
  | { type: "ticket"; kind: "inquiry" | "complaint" | "callback" | "reschedule"; subject: string; body?: string; priority?: "normal" | "high" }
  | { type: "escalate"; severity: "urgent" | "high" | "normal" | "low"; category: "clinical" | "medication" | "complaint" | "booking" | "other"; summary: string; patient_text?: string }
  | { type: "survey"; score: number; comment?: string }
  | { type: "opt_out" };
export type Say = { key: string; template?: string };
export type Step = {
  state: string; status: "scheduled" | "waiting" | "human" | "completed" | "no_response" | "opted_out";
  data: Record<string, unknown>; outcome?: string; say: Say[]; actions: Action[]; intent?: string;
  waitHours?: number; scheduleInHours?: number; opened?: boolean; nudged?: boolean; channel?: Channel; endCall?: boolean;
};

const EXPECT: Record<string, Intent[]> = {
  confirm: ["yes", "reschedule", "cancel", "question"],
  cancel_check: ["cancel", "reschedule", "keep"],
  identify: ["yes", "no", "later"],
  consent_q: ["yes", "later", "no"],
  meds: ["yes", "partly", "no"],
  meds_why: ["side_effects", "cost", "forgot", "text"],
  improve: ["better", "same", "worse"],
  problems: ["none", "complaint", "clinical", "text"],
  rating: ["rating"],
  followup_offer: ["yes", "no"],
  followup_q: ["yes", "already", "not_needed"],
  followup_why: ["text"],
};

const OPENER: Record<Kind, string> = { booking_confirm: "open_booking_confirm", pre_visit: "open_pre_visit", post_visit: "open_post_visit", followup: "open_followup" };
const FIRST_STATE: Record<Kind, string> = { booking_confirm: "confirm", pre_visit: "confirm", post_visit: "consent_q", followup: "followup_q" };

function say(key: string, ctx: Ctx, template = false): Say {
  return template && ctx.channel === "whatsapp" && TEMPLATE_FOR[key] ? { key, template: TEMPLATE_FOR[key] } : { key };
}

export function step(ctx: Ctx, ev: Event): Step {
  const data = { ...(ctx.data ?? {}) };
  const base = { data, actions: [] as Action[], say: [] as Say[] };
  const wait = (state: string, keys: Say[], extra: Partial<Step> = {}): Step =>
    ({ ...base, ...extra, state, status: "waiting", say: [...(extra.say ?? []), ...keys], waitHours: ctx.nudge_after_hours });
  const done = (outcome: string, keys: Say[], extra: Partial<Step> = {}): Step =>
    ({ ...base, ...extra, state: "done", status: "completed", outcome, say: [...(extra.say ?? []), ...keys], endCall: true });

  // ---- Opening
  if (ev.type === "open") {
    if (ctx.channel === "voice") return wait("identify", [say("voice_identify", ctx)], { opened: true });
    return wait(FIRST_STATE[ctx.kind], [say(OPENER[ctx.kind], ctx, true)], { opened: true });
  }

  // ---- No reply in time
  if (ev.type === "nudge") {
    const answered = Boolean(data.answered);
    if (!answered && ctx.channel === "whatsapp" && ctx.nudges < ctx.max_nudges) {
      return { ...wait(ctx.state, [say("nudge", ctx, true)]), nudged: true };
    }
    if (answered) return { ...base, state: "done", status: "completed", outcome: "partial", say: [] };
    if (ctx.channel === "whatsapp" && ctx.voice_enabled && ctx.voice_fallback) {
      return { ...base, state: "start", status: "scheduled", channel: "voice", scheduleInHours: 0, say: [] };
    }
    const actions: Action[] = [];
    if (ctx.kind === "booking_confirm" || ctx.kind === "pre_visit") {
      actions.push({ type: "ticket", kind: "callback", subject: "لم يرد على تأكيد الموعد — يرجى الاتصال / No reply to appointment confirmation — please call" });
    } else if (ctx.kind === "followup") {
      actions.push({ type: "ticket", kind: "callback", subject: "لم يرد على تذكير المتابعة — يرجى الاتصال / No reply to follow-up reminder — please call" });
    }
    return { ...base, actions, state: "done", status: "no_response", outcome: "no_response", say: [] };
  }

  // ---- A patient reply
  const text = ev.text ?? "";
  data.answered = true;
  const s = safety(text);
  if (s.urgent || ev.hint?.urgent) {
    return {
      ...base, state: ctx.state, status: "human", outcome: "urgent", intent: "urgent", endCall: true,
      say: [say(urgentScript(s.selfHarm, ctx.in_hours !== false), ctx)],
      actions: [{ type: "escalate", severity: "urgent", category: "clinical", summary: s.selfHarm ? "عبارات إيذاء النفس — اتصل فورًا / Self-harm statement — call now" : "علامات خطر في رد المريض — اتصل فورًا / Danger signs in the patient's reply — call now", patient_text: text }],
    };
  }
  if (s.optOut) return { ...base, state: "done", status: "opted_out", outcome: "opted_out", intent: "opt_out", endCall: true, say: [say("opted_out", ctx)], actions: [{ type: "opt_out" }] };
  if (s.human) {
    return { ...base, state: ctx.state, status: "human", outcome: "handed_off", intent: "human", endCall: true, say: [say("human_handoff", ctx)],
      actions: [{ type: "ticket", kind: "callback", subject: "المريض طلب التحدث مع موظف / Patient asked to speak to a person", body: text, priority: "high" }] };
  }

  const expected = EXPECT[ctx.state] ?? [];
  let intent: Intent = classify(text, expected);
  if ((intent === "unknown" || intent === "text") && ev.hint?.intent && expected.includes(ev.hint.intent)) intent = ev.hint.intent;
  const strike = (key: string): Step => {
    const misses = Number(data.misses ?? 0) + 1;
    data.misses = misses;
    if (intent === "empty" && ctx.channel === "voice" && misses >= 2) {
      return { ...base, state: "done", status: "no_response", outcome: "no_response", intent, endCall: true, say: [say("voice_silence_end", ctx)] };
    }
    if (misses >= 3) {
      return done("handed_off", [say("handoff", ctx)], { intent, actions: [{ type: "ticket", kind: "callback", subject: "المساعد لم يفهم ردود المريض — يرجى الاتصال / Assistant could not understand the patient — please call", body: text }] });
    }
    return { ...wait(ctx.state, [say(key, ctx)]), intent };
  };
  const r = (s: Step): Step => ({ ...s, intent });

  switch (ctx.state) {
    // Voice only: make sure we speak to the patient before saying anything about their care.
    case "identify": {
      if (intent === "yes") {
        const k = OPENER[ctx.kind];
        return r(wait(FIRST_STATE[ctx.kind], [say(k, ctx)]));
      }
      if (intent === "later") return r({ ...base, state: "start", status: "scheduled", scheduleInHours: 3, say: [say("later_ack", ctx)], endCall: true });
      if (intent === "no") return r({ ...base, state: "done", status: "no_response", outcome: "wrong_person", say: [say("voice_wrong_person", ctx)], endCall: true,
        actions: [{ type: "ticket", kind: "callback", subject: "رد شخص آخر على مكالمة المساعد — تحقق من رقم المريض / Someone else answered — check the patient's number" }] });
      return strike("reask_generic");
    }

    case "confirm": {
      if (!bookable(ctx)) return r(changed(ctx, base));
      if (intent === "yes") {
        const actions: Action[] = ctx.appointment_status === "confirmed" ? [] : [{ type: "confirm_appointment" }];
        return r(done("confirmed", [say("confirmed", ctx)], { actions }));
      }
      if (intent === "reschedule") {
        return r(done("reschedule_requested", [say("reschedule_ack", ctx)], { actions: [{ type: "ticket", kind: "reschedule", subject: "طلب تغيير موعد عبر المساعد / Reschedule request via the assistant", body: text }] }));
      }
      if (intent === "cancel") return r(wait("cancel_check", [say("cancel_check", ctx)]));
      if (intent === "question") {
        return r({ ...wait("confirm", [say("question_forwarded", ctx), say("reask_confirm", ctx)]),
          actions: [{ type: "ticket", kind: "inquiry", subject: "سؤال من المريض أثناء تأكيد الموعد / Question during confirmation", body: text }] });
      }
      return strike("reask_confirm");
    }

    case "cancel_check": {
      if (!bookable(ctx)) return r(changed(ctx, base));
      if (intent === "cancel") {
        // Inside the clinic's cancellation window a person decides (same rule as online cancellation).
        if (ctx.cancel_allowed === false) {
          return r(done("cancel_requested", [say("cancel_request_ack", ctx)], {
            actions: [{ type: "ticket", kind: "reschedule", subject: "طلب إلغاء داخل مهلة الإلغاء / Cancellation request inside the cancellation window", body: text, priority: "high" }] }));
        }
        return r(done("cancelled", [say("cancelled_ack", ctx)], { actions: [{ type: "cancel_appointment" }] }));
      }
      if (intent === "reschedule") {
        return r(done("reschedule_requested", [say("reschedule_ack", ctx)], { actions: [{ type: "ticket", kind: "reschedule", subject: "طلب تغيير موعد عبر المساعد / Reschedule request via the assistant", body: text }] }));
      }
      if (intent === "keep") {
        const actions: Action[] = ctx.appointment_status === "confirmed" ? [] : [{ type: "confirm_appointment" }];
        return r(done("confirmed", [say("kept_ack", ctx)], { actions }));
      }
      return strike("reask_generic");
    }

    // ---- After the visit
    case "consent_q": {
      if (intent === "yes") return r(ctx.has_rx ? wait("meds", [say("ask_meds", ctx)]) : wait("improve", [say("ask_improve", ctx)]));
      if (intent === "later") {
        if (data.postponed) return r(done("declined", [say("declined_ack", ctx)]));
        data.postponed = true; data.answered = false;
        return r({ ...base, state: "start", status: "scheduled", scheduleInHours: 4, say: [say("later_ack", ctx)], endCall: true });
      }
      if (intent === "no") return r(done("declined", [say("declined_ack", ctx)]));
      return strike("reask_generic");
    }
    case "meds": {
      if (intent === "yes") { data.meds = "yes"; return r(wait("improve", [say("ask_improve", ctx)])); }
      if (intent === "partly" || intent === "no") { data.meds = intent; return r(wait("meds_why", [say("ask_meds_why", ctx)])); }
      return strike("reask_generic");
    }
    case "meds_why": {
      if (intent === "side_effects") {
        data.meds_why = "side_effects";
        return r({ ...wait("improve", [say("side_effects_ack", ctx), say("ask_improve", ctx)]),
          actions: [{ type: "escalate", severity: "high", category: "medication", summary: "أعراض جانبية من العلاج / Side effects from the treatment", patient_text: text }] });
      }
      if (intent === "cost") {
        data.meds_why = "cost";
        return r({ ...wait("improve", [say("cost_ack", ctx), say("ask_improve", ctx)]),
          actions: [{ type: "escalate", severity: "normal", category: "medication", summary: "العلاج غالي أو غير متوفر — يحتاج بديل / Treatment too expensive or unavailable — needs an alternative", patient_text: text }] });
      }
      if (intent === "forgot") { data.meds_why = "forgot"; return r(wait("improve", [say("forgot_tip", ctx), say("ask_improve", ctx)])); }
      if (intent === "text") {
        data.meds_why = "other";
        return r({ ...wait("improve", [say("noted", ctx), say("ask_improve", ctx)]),
          actions: [{ type: "escalate", severity: "normal", category: "medication", summary: "المريض لا يلتزم بالعلاج / Patient not taking the treatment as prescribed", patient_text: text }] });
      }
      return strike("reask_generic");
    }
    case "improve": {
      if (intent === "better") { data.improve = "better"; return r(wait("problems", [say("glad", ctx), say("ask_problems", ctx)])); }
      if (intent === "same") {
        data.improve = "same";
        return r({ ...wait("problems", [say("same_ack", ctx), say("ask_problems", ctx)]),
          actions: [{ type: "escalate", severity: "low", category: "clinical", summary: "لا يوجد تحسن بعد الزيارة / No improvement since the visit" }] });
      }
      if (intent === "worse") {
        data.improve = "worse";
        return r({ ...wait("problems", [say("worse_ack", ctx), say("ask_problems", ctx)]),
          actions: [{ type: "escalate", severity: "high", category: "clinical", summary: "الحالة أسوأ بعد الزيارة / Feeling worse since the visit", patient_text: text }] });
      }
      return strike("reask_generic");
    }
    case "problems": {
      // The rating is stored against the visit's appointment, so it is asked only when there is one.
      const after = (keys: Say[], actions: Action[] = []) => {
        const next = ctx.date ? wait("rating", [say("ask_rating", ctx)]) : closePostVisit(ctx, base);
        return r({ ...next, say: [...keys, ...next.say], actions });
      };
      if (intent === "none") return after([]);
      data.problems = text.slice(0, 500);
      if (intent === "complaint") {
        return after([say("complaint_ack", ctx)], [{ type: "ticket", kind: "complaint", subject: "ملاحظة من المريض بعد الزيارة / Patient feedback after the visit", body: text, priority: "high" }]);
      }
      if (intent === "clinical") {
        return after([say("noted", ctx)], [{ type: "escalate", severity: "normal", category: "clinical", summary: "شكوى صحية بعد الزيارة / Health concern after the visit", patient_text: text }]);
      }
      if (intent === "text") {
        // Free text after a visit may be clinical in words the rules do not know: the doctor sees it.
        return after([say("noted", ctx)], [{ type: "escalate", severity: "normal", category: "clinical", summary: "رسالة من المريض بعد الزيارة / Patient message after the visit", patient_text: text }]);
      }
      return strike("reask_generic");
    }
    case "rating": {
      const n = ratingOf(text);
      if (n == null) {
        if (Number(data.misses ?? 0) >= 1) return r(closePostVisit(ctx, base));
        return strike("reask_generic");
      }
      data.rating = n;
      const actions: Action[] = [{ type: "survey", score: n }];
      if (n <= 2) actions.push({ type: "ticket", kind: "complaint", subject: `تقييم منخفض للزيارة (${n}/5) / Low visit rating (${n}/5)`, priority: "high" });
      const close = closePostVisit(ctx, base);
      return { ...close, intent: "rating", say: [say(n <= 2 ? "rating_low" : "rating_high", ctx), ...close.say], actions };
    }
    case "followup_offer": {
      if (intent === "yes") {
        data.followup_offer = "yes";
        return r(done("answered", [say("followup_booking_ack", ctx), say("goodbye", ctx)], {
          actions: [{ type: "ticket", kind: "callback", subject: `حجز متابعة يوم ${ctx.followup_due} / Book follow-up on ${ctx.followup_due}` }] }));
      }
      if (intent === "no") { data.followup_offer = "self"; return r(done("answered", [say("followup_self_ack", ctx), say("goodbye", ctx)])); }
      return strike("reask_generic");
    }

    // ---- Follow-up consultation reminder
    case "followup_q": {
      if (intent === "yes") {
        return r(done("booking_requested", [say("followup_booking_ack", ctx)], {
          actions: [{ type: "ticket", kind: "callback", subject: `حجز متابعة يوم ${ctx.followup_due} / Book follow-up on ${ctx.followup_due}` }] }));
      }
      if (intent === "already") return r(done("says_booked", [say("followup_already", ctx)]));
      if (intent === "not_needed") return r(wait("followup_why", [say("ask_followup_why", ctx)]));
      return strike("reask_generic");
    }
    case "followup_why": {
      if (intent === "empty") return strike("reask_generic");
      data.followup_why = text.slice(0, 500);
      return r(done("declined", [say("noted", ctx), say("goodbye", ctx)], {
        actions: [{ type: "escalate", severity: "low", category: "clinical", summary: "المريض لا يرغب في المتابعة / Patient does not want the follow-up", patient_text: text }] }));
    }
  }
  // A reply after the conversation ended (or an unknown state): thank and close politely.
  if (s.thanks) return { ...base, state: ctx.state, status: ctx.status as Step["status"], say: [say("welcome", ctx)], intent: "thanks" };
  return { ...base, state: ctx.state, status: ctx.status as Step["status"], say: [], intent: "late_reply" };
}

export function urgentScript(selfHarm: boolean, inHours: boolean) {
  return selfHarm ? (inHours ? "crisis" : "crisis_after_hours") : inHours ? "emergency" : "emergency_after_hours";
}

const bookable = (ctx: Ctx) => !ctx.appointment_status || ["booked", "pending_confirmation", "confirmed"].includes(ctx.appointment_status);
function changed(ctx: Ctx, base: { data: Record<string, unknown>; actions: Action[]; say: Say[] }): Step {
  return { ...base, state: "done", status: "completed", outcome: "appointment_changed", endCall: true, say: [say("appointment_changed", ctx)],
    actions: [{ type: "ticket", kind: "callback", subject: "رد المريض على موعد تغيّر أو أُلغي — يرجى الاتصال / Patient replied about an appointment that changed — please call" }] };
}

function closePostVisit(ctx: Ctx, base: { data: Record<string, unknown>; actions: Action[]; say: Say[] }): Step {
  if (ctx.followup_due) {
    return { ...base, state: "followup_offer", status: "waiting", say: [say("ask_followup_offer", ctx)], waitHours: ctx.nudge_after_hours };
  }
  return { ...base, state: "done", status: "completed", outcome: "answered", say: [say("goodbye", ctx)], endCall: true };
}

/** Variables the scripts use. */
export function scriptVars(ctx: Ctx): Record<string, string> {
  const en = ctx.lang === "en";
  return {
    name: (en ? ctx.name_en : ctx.name) ?? ctx.name ?? "",
    doctor: (en ? ctx.doctor_en : ctx.doctor) ?? ctx.doctor ?? "",
    date: ctx.date ?? "", time: ctx.time ?? "", due: ctx.followup_due ?? "",
    phone_part: ctx.clinic_phone ? (en ? ` on ${ctx.clinic_phone}` : ` على ${ctx.clinic_phone}`) : "",
  };
}
