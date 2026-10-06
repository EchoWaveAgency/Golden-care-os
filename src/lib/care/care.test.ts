import { describe, expect, it } from "vitest";
import { classify, normalize, ratingOf, safety } from "./nlu";
import { step, scriptVars, type Ctx } from "./engine";
import { render, SCRIPTS } from "./scripts";

const base = (over: Partial<Ctx> = {}): Ctx => ({
  kind: "booking_confirm", channel: "whatsapp", lang: "ar", state: "start", data: {}, status: "scheduled",
  name: "عمر", doctor: "د. كريم", date: "2026-10-08", time: "11:00", nudges: 0, max_nudges: 1, nudge_after_hours: 4,
  appointment_status: "booked", ...over,
});

describe("normalize", () => {
  it("unifies Arabic letters, digits and punctuation", () => {
    expect(normalize("أيوة!!")).toBe(" ايوه ");
    expect(normalize("١")).toBe(" 1 ");
    expect(normalize("إلغاء الموعد؟")).toBe(" الغاء الموعد ");
  });
});

describe("safety", () => {
  it.each(["مش قادر اتنفس", "عندي ضيق في النفس من امبارح", "فيه نزيف", "وشي ورم بعد الدوا", "I have chest pain", "اغمى عليا الصبح"])("flags danger: %s", (t) => {
    expect(safety(t).urgent).toBe(true);
  });
  it("flags self-harm separately", () => {
    expect(safety("عايز اموت").selfHarm).toBe(true);
    expect(safety("عايز اموت").urgent).toBe(true);
  });
  it.each(["بنزف", "عندي النزيف", "هنتحر", "هموت نفسي", "صدري بيوجعني جامد", "عندي ضيق في صدري", "حرارتي ٤٠", "حرارته 39.5",
    "difficulty breathing", "my chest hurts", "allergic reaction", "شفايفي اتورمت بعد الدوا"])("catches prefixed / two-part danger signs: %s", (t) => {
    expect(safety(t).urgent).toBe(true);
  });
  it.each(["الحمد لله احسن", "تمام", "1", "الدوا غالي شوية", "عملت blood test امبارح", "هموت من الضحك", "نفسي اجي بدري بس مش قادر النهارده",
    "الحرارة نزلت الحمد لله", "نفس الحال"])("does not over-trigger: %s", (t) => {
    expect(safety(t).urgent).toBe(false);
  });
  it("detects opt-out, asking for a person and thanks", () => {
    expect(safety("STOP").optOut).toBe(true);
    expect(safety("مش عايز رسايل تاني").optOut).toBe(true);
    expect(safety("عايز اكلم حد لو سمحت").human).toBe(true);
    expect(safety("شكرا جدا").thanks).toBe(true);
  });
  it("'stop' inside a sentence is not an opt-out", () => {
    expect(safety("the pain won't stop").optOut).toBe(false);
    expect(safety("I had to stop the pills").optOut).toBe(false);
    expect(safety("Stop").optOut).toBe(true);
    expect(safety("stop messages please").optOut).toBe(true);
  });
});

describe("classify", () => {
  const confirm = ["yes", "reschedule", "cancel", "question"] as const;
  it.each([["1", "yes"], ["أيوه", "yes"], ["تمام ان شاء الله", "yes"], ["اكيد جاي", "yes"], ["2", "reschedule"], ["ممكن نغير الميعاد ليوم تاني", "reschedule"],
    ["3", "cancel"], ["الغي لو سمحت", "cancel"], ["مش هقدر اجي", "cancel"], ["هو الكشف بكام؟", "question"], ["٣", "cancel"], ["ok", "yes"]] as const)("confirm: %s → %s", (t, i) => {
    expect(classify(t, [...confirm])).toBe(i);
  });
  it("negations are never read as yes", () => {
    for (const t of ["مش تمام", "مش موافق", "مش اكيد", "not ok"]) expect(classify(t, ["yes", "reschedule", "cancel", "question"]), t).not.toBe("yes");
    expect(classify("الحمد لله بس لسه تعبان", ["better", "same", "worse"])).not.toBe("better");
  });
  it("improvement with negation", () => {
    const e = ["better", "same", "worse"] as const;
    expect(classify("احسن كتير", [...e])).toBe("better");
    expect(classify("مش كويس خالص", [...e])).toBe("worse");
    expect(classify("مش احسن", [...e])).toBe("same");
    expect(classify("زي ما انا", [...e])).toBe("same");
    expect(classify("اسوأ", [...e])).toBe("worse");
  });
  it("problems: none, complaint, clinical, free text", () => {
    const e = ["none", "complaint", "clinical", "text"] as const;
    expect(classify("0", [...e])).toBe("none");
    expect(classify("لا مفيش", [...e])).toBe("none");
    expect(classify("استنيت ساعتين في الاستقبال", [...e])).toBe("complaint");
    expect(classify("عندي صداع من الدوا", [...e])).toBe("clinical");
    expect(classify("عايز صورة من الروشتة", [...e])).toBe("text");
  });
  it("ratings in digits and words", () => {
    expect(ratingOf("5")).toBe(5);
    expect(ratingOf("٤")).toBe(4);
    expect(ratingOf("اربعة")).toBe(4);
    expect(ratingOf("هديكم 3 من 5")).toBe(3);
    expect(ratingOf("10")).toBeNull();
  });
});

describe("booking confirmation", () => {
  it("opens with the approved template and waits", () => {
    const s = step(base(), { type: "open" });
    expect(s.state).toBe("confirm");
    expect(s.status).toBe("waiting");
    expect(s.say).toEqual([{ key: "open_booking_confirm", template: "care_booking_confirm" }]);
    expect(s.opened).toBe(true);
  });
  it("confirms the appointment", () => {
    const s = step(base({ state: "confirm", status: "waiting" }), { type: "text", text: "1" });
    expect(s.status).toBe("completed");
    expect(s.outcome).toBe("confirmed");
    expect(s.actions).toEqual([{ type: "confirm_appointment" }]);
  });
  it("does not re-confirm an appointment the desk already confirmed", () => {
    expect(step(base({ state: "confirm", appointment_status: "confirmed" }), { type: "text", text: "ايوه" }).actions).toEqual([]);
  });
  it("asks before cancelling, offers to change instead", () => {
    const a = step(base({ state: "confirm" }), { type: "text", text: "3" });
    expect(a.state).toBe("cancel_check");
    expect(a.actions).toEqual([]);
    const b = step(base({ state: "cancel_check" }), { type: "text", text: "1" });
    expect(b.outcome).toBe("cancelled");
    expect(b.actions).toEqual([{ type: "cancel_appointment" }]);
    const c = step(base({ state: "cancel_check" }), { type: "text", text: "2" });
    expect(c.outcome).toBe("reschedule_requested");
    expect(c.actions[0]).toMatchObject({ type: "ticket", kind: "reschedule" });
    const d = step(base({ state: "cancel_check" }), { type: "text", text: "سيبه" });
    expect(d.outcome).toBe("confirmed");
  });
  it("forwards a question and asks again", () => {
    const s = step(base({ state: "confirm" }), { type: "text", text: "هو فيه ركنة قريبة؟" });
    expect(s.state).toBe("confirm");
    expect(s.say.map((x) => x.key)).toEqual(["question_forwarded", "reask_confirm"]);
    expect(s.actions[0]).toMatchObject({ type: "ticket", kind: "inquiry" });
  });
  it("hands over to a person after three misunderstandings", () => {
    let ctx = base({ state: "confirm" });
    for (let i = 0; i < 2; i++) {
      const s = step(ctx, { type: "text", text: "زززز" });
      expect(s.state).toBe("confirm");
      ctx = { ...ctx, data: s.data };
    }
    const last = step(ctx, { type: "text", text: "زززز" });
    expect(last.outcome).toBe("handed_off");
    expect(last.actions[0]).toMatchObject({ type: "ticket", kind: "callback" });
  });
  it("nudges once, then hands the call list to staff", () => {
    const a = step(base({ state: "confirm", status: "waiting" }), { type: "nudge" });
    expect(a.nudged).toBe(true);
    expect(a.say[0]).toEqual({ key: "nudge", template: "care_nudge" });
    const b = step(base({ state: "confirm", status: "waiting", nudges: 1 }), { type: "nudge" });
    expect(b.status).toBe("no_response");
    expect(b.actions[0]).toMatchObject({ type: "ticket", kind: "callback" });
  });
  it("falls back to a call when voice is on", () => {
    const s = step(base({ state: "confirm", status: "waiting", nudges: 1, voice_enabled: true, voice_fallback: true }), { type: "nudge" });
    expect(s.channel).toBe("voice");
    expect(s.status).toBe("scheduled");
  });
});

describe("appointment changes and the cancellation window", () => {
  it("never confirms an appointment that was cancelled meanwhile", () => {
    const s = step(base({ state: "confirm", appointment_status: "canceled" }), { type: "text", text: "1" });
    expect(s.outcome).toBe("appointment_changed");
    expect(s.say[0].key).toBe("appointment_changed");
    expect(s.actions).toEqual([expect.objectContaining({ type: "ticket", kind: "callback" })]);
  });
  it("inside the cancellation window a cancel becomes a request for reception", () => {
    const s = step(base({ state: "cancel_check", cancel_allowed: false }), { type: "text", text: "1" });
    expect(s.outcome).toBe("cancel_requested");
    expect(s.actions[0]).toMatchObject({ type: "ticket", kind: "reschedule", priority: "high" });
    expect(s.actions.some((a) => a.type === "cancel_appointment")).toBe(false);
  });
  it("side-effect reply gives no instruction about stopping treatment", () => {
    expect(render("side_effects_ack", "whatsapp", "ar", {})).not.toMatch(/توقف|متغيرش/);
    expect(render("side_effects_ack", "whatsapp", "en", {})).not.toMatch(/stop/i);
  });
  it("free text after a visit reaches the doctor", () => {
    const s = step(base({ kind: "post_visit", state: "problems" }), { type: "text", text: "مش قادر انام من الوجع" });
    expect(s.actions[0]).toMatchObject({ type: "escalate", category: "clinical" });
  });
  it("after-hours danger message does not promise an immediate call", () => {
    const s = step(base({ state: "improve", kind: "post_visit", in_hours: false }), { type: "text", text: "عندي نزيف" });
    expect(s.say[0].key).toBe("emergency_after_hours");
    expect(render("emergency_after_hours", "whatsapp", "ar", {})).toContain("123");
  });
});

describe("safety always comes first", () => {
  it("danger signs escalate urgently and pause the assistant, in any state", () => {
    for (const state of ["confirm", "meds", "improve", "rating"]) {
      const s = step(base({ kind: "post_visit", state }), { type: "text", text: "مش قادر اتنفس" });
      expect(s.status).toBe("human");
      expect(s.say[0].key).toBe("emergency");
      expect(s.actions[0]).toMatchObject({ type: "escalate", severity: "urgent", category: "clinical" });
    }
  });
  it("self-harm gets the crisis message", () => {
    expect(step(base({ state: "problems", kind: "post_visit" }), { type: "text", text: "انا عايز اموت" }).say[0].key).toBe("crisis");
  });
  it("a model hint can raise urgency but rules cannot be lowered", () => {
    const s = step(base({ state: "improve", kind: "post_visit" }), { type: "text", text: "حاجة غريبة", hint: { urgent: true } });
    expect(s.outcome).toBe("urgent");
  });
  it("opt-out stops and records refusal", () => {
    const s = step(base({ state: "confirm" }), { type: "text", text: "stop" });
    expect(s.status).toBe("opted_out");
    expect(s.actions).toEqual([{ type: "opt_out" }]);
  });
  it("asking for a person hands over", () => {
    const s = step(base({ state: "meds", kind: "post_visit" }), { type: "text", text: "عايز اكلم حد" });
    expect(s.status).toBe("human");
    expect(s.actions[0]).toMatchObject({ type: "ticket", kind: "callback", priority: "high" });
  });
});

describe("after the visit", () => {
  const pv = (over: Partial<Ctx> = {}) => base({ kind: "post_visit", has_rx: true, ...over });
  it("asks about medication only when there is a prescription", () => {
    expect(step(pv({ state: "consent_q" }), { type: "text", text: "1" }).state).toBe("meds");
    expect(step(pv({ state: "consent_q", has_rx: false }), { type: "text", text: "1" }).state).toBe("improve");
  });
  it("postpones once, then closes politely", () => {
    const a = step(pv({ state: "consent_q" }), { type: "text", text: "مش دلوقتي" });
    expect(a.status).toBe("scheduled");
    expect(a.scheduleInHours).toBe(4);
    const b = step(pv({ state: "consent_q", data: a.data }), { type: "text", text: "2" });
    expect(b.outcome).toBe("declined");
  });
  it("side effects go to the doctor with a safety line", () => {
    const a = step(pv({ state: "meds" }), { type: "text", text: "3" });
    expect(a.state).toBe("meds_why");
    expect(a.data.meds).toBe("no");
    const b = step(pv({ state: "meds_why", data: a.data }), { type: "text", text: "1" });
    expect(b.state).toBe("improve");
    expect(b.say.map((x) => x.key)).toEqual(["side_effects_ack", "ask_improve"]);
    expect(b.actions[0]).toMatchObject({ type: "escalate", severity: "high", category: "medication" });
  });
  it("forgetting gets a friendly tip, not an escalation", () => {
    const b = step(pv({ state: "meds_why" }), { type: "text", text: "نسيت" });
    expect(b.actions).toEqual([]);
    expect(b.say[0].key).toBe("forgot_tip");
  });
  it("worse is escalated high; same is noted for the doctor", () => {
    expect(step(pv({ state: "improve" }), { type: "text", text: "3" }).actions[0]).toMatchObject({ severity: "high", category: "clinical" });
    expect(step(pv({ state: "improve" }), { type: "text", text: "2" }).actions[0]).toMatchObject({ severity: "low" });
    expect(step(pv({ state: "improve" }), { type: "text", text: "1" }).actions).toEqual([]);
  });
  it("a service complaint becomes a complaint ticket, then rating", () => {
    const s = step(pv({ state: "problems" }), { type: "text", text: "الاستقبال اتأخر علينا ساعة" });
    expect(s.actions[0]).toMatchObject({ type: "ticket", kind: "complaint" });
    expect(s.state).toBe("rating");
  });
  it("no rating question without an appointment", () => {
    expect(step(pv({ state: "problems", date: null }), { type: "text", text: "0" }).state).toBe("done");
  });
  it("records the rating; a low one opens a complaint", () => {
    const hi = step(pv({ state: "rating" }), { type: "text", text: "5" });
    expect(hi.actions).toEqual([{ type: "survey", score: 5 }]);
    expect(hi.outcome).toBe("answered");
    const lo = step(pv({ state: "rating" }), { type: "text", text: "1" });
    expect(lo.actions[1]).toMatchObject({ type: "ticket", kind: "complaint", priority: "high" });
  });
  it("offers to book the follow-up the doctor asked for", () => {
    const s = step(pv({ state: "rating", followup_due: "2026-10-20" }), { type: "text", text: "4" });
    expect(s.state).toBe("followup_offer");
    const y = step(pv({ state: "followup_offer", followup_due: "2026-10-20" }), { type: "text", text: "1" });
    expect(y.actions[0]).toMatchObject({ type: "ticket", kind: "callback" });
    expect(y.outcome).toBe("answered");
  });
  it("a partial conversation closes on silence without nudging", () => {
    expect(step(pv({ state: "improve", data: { answered: true } }), { type: "nudge" }).outcome).toBe("partial");
  });
});

describe("follow-up reminder", () => {
  const fu = (over: Partial<Ctx> = {}) => base({ kind: "followup", followup_due: "2026-10-20", ...over });
  it("books, notes already booked, or asks why", () => {
    expect(step(fu({ state: "followup_q" }), { type: "text", text: "1" }).outcome).toBe("booking_requested");
    expect(step(fu({ state: "followup_q" }), { type: "text", text: "حجزت خلاص" }).outcome).toBe("says_booked");
    const w = step(fu({ state: "followup_q" }), { type: "text", text: "3" });
    expect(w.state).toBe("followup_why");
    const d = step(fu({ state: "followup_why" }), { type: "text", text: "اتحسنت الحمد لله" });
    expect(d.actions[0]).toMatchObject({ type: "escalate", severity: "low" });
  });
});

describe("voice", () => {
  it("checks identity before saying anything about the visit", () => {
    const s = step(base({ channel: "voice" }), { type: "open" });
    expect(s.state).toBe("identify");
    expect(s.say[0].key).toBe("voice_identify");
    const wrong = step(base({ channel: "voice", state: "identify" }), { type: "text", text: "لا مش هو" });
    expect(wrong.outcome).toBe("wrong_person");
    expect(wrong.endCall).toBe(true);
    const ok = step(base({ channel: "voice", state: "identify" }), { type: "text", text: "ايوه انا" });
    expect(ok.state).toBe("confirm");
  });
  it("ends the call after silence", () => {
    const a = step(base({ channel: "voice", state: "confirm" }), { type: "text", text: "" });
    const b = step(base({ channel: "voice", state: "confirm", data: a.data }), { type: "text", text: "" });
    expect(b.status).toBe("no_response");
    expect(b.say[0].key).toBe("voice_silence_end");
  });
  it("voice wording never asks to send numbers", () => {
    for (const [k, l] of Object.entries(SCRIPTS)) {
      if (l.voice_ar) expect(l.voice_ar, k).not.toMatch(/ابعت/);
    }
    expect(render("ask_meds", "voice", "ar", {})).toContain("قول");
  });
});

describe("scripts", () => {
  it("fill variables in both languages", () => {
    const v = scriptVars(base({ clinic_phone: "0225555555" }));
    expect(render("open_booking_confirm", "whatsapp", "ar", v)).toContain("د. كريم");
    expect(render("goodbye", "whatsapp", "ar", v)).toContain("على 0225555555");
    expect(render("goodbye", "whatsapp", "en", scriptVars(base({ lang: "en", name_en: "Omar" })))).toContain("Omar");
  });
  it("every script has Arabic and English", () => {
    for (const [k, l] of Object.entries(SCRIPTS)) {
      if (l.ar) expect(l.en, k).toBeTruthy();
      if (l.voice_ar) expect(l.voice_en, k).toBeTruthy();
    }
  });
});

describe("crisis line", () => {
  it("is filled in every crisis message", () => {
    for (const ch of ["whatsapp", "voice"] as const) for (const l of ["ar", "en"] as const) expect(render("crisis", ch, l, {})).toContain("16328");
  });
});
