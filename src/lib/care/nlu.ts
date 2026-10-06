// Rule-based understanding of short patient replies in Egyptian Arabic and English.
// Safety signals (danger signs, opt-out, asking for a person) are always checked here first, whatever else is used.

export type Intent =
  | "yes" | "no" | "reschedule" | "cancel" | "keep" | "later"
  | "partly" | "side_effects" | "cost" | "forgot"
  | "better" | "same" | "worse" | "none" | "already" | "not_needed"
  | "rating" | "question" | "complaint" | "clinical" | "thanks" | "text" | "empty" | "unknown";

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9" };
const NUMBER_WORDS: Record<string, string> = { "صفر": "0", "واحد": "1", "واحده": "1", "اتنين": "2", "اثنين": "2", "تلاته": "3", "ثلاثه": "3",
  "اربعه": "4", "خمسه": "5", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "zero": "0" };

/** Lower-case, no diacritics/tatweel, unified alef/yaa/taa marbuta/hamza seats, Western digits, no punctuation or emoji. */
export function normalize(text: string): string {
  return ` ${(text ?? "")
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const has = (t: string, words: string[]) => words.some((w) => t.includes(` ${w} `) || (w.includes(" ") && t.includes(w)));
const only = (t: string, words: string[]) => words.includes(t.trim());

// Danger signs. Arabic words take prefixes (ب، ه، ال، و، ف، ل), so stems are matched anywhere in the text;
// some signs need two parts (chest + pain, temperature + a high number). Erring on the side of escalating.
const RED_STEMS = [
  "نزيف", "نزف", "بينزف", "دم كتير", "بيجيب دم", "بترجع دم", "برجع دم", "اغمي", "اغما", "فقدت الوعي", "فاقد الوعي", "مش بيفوق", "تشنج",
  "زوري بيقفل", "حلقي بيقفل", "زوري قافل", "شلل", "اتشليت", "تنميل في نص", "وشي اتعوج", "بقي اتعوج", "طفح شديد", "مش شايف", "زغلله شديده",
  "بتخنق", "بختنق", "نفسي مقطوع", "مش قادر اتنفس", "مش قادره اتنفس", "مش عارف اتنفس", "مش عارفه اتنفس", "صعوبه في التنفس", "صعوبه في النفس",
  "مش لاحق نفسي", "الم شديد جدا", "وجع جامد جدا", "وجع مش طبيعي", "الم مش طبيعي",
  "can t breathe", "cant breathe", "cannot breathe", "short of breath", "shortness of breath", "difficulty breathing", "trouble breathing", "hard to breathe",
  "chest pain", "chest hurts", "bleeding", "coughing blood", "vomiting blood", "blood in", "fainted", "passed out", "unconscious", "seizure", "convulsion", "allergic reaction", "anaphyla",
  "face swelling", "swollen face", "swollen lips", "throat closing", "throat is closing", "high fever", "severe pain", "paralysis", "numb on one side",
];
const SELF_HARM_STEMS = ["انتحر", "نتحر", "موت نفسي", "قتل نفسي", "اذي نفسي", "عايز اموت", "عاوز اموت", "عايزه اموت", "نفسي اموت", "هموت نفسي", "مش عايز اعيش", "مش عاوز اعيش", "مش عايزه اعيش",
  "suicid", "kill myself", "end my life", "hurt myself", "don t want to live", "want to die"];
const BODY_DANGER: [string[], string[]][] = [
  [["صدري", "صدر", "قلبي"], ["وجع", "يوجع", "بيوجع", "الم", "واجع", "ضيق", "تقل", "بيضغط", "نغز"]],
  [["تنفس", "اتنفس", "النفس", "نفسي مكتوم", "نفسي ضيق"], ["ضيق", "مكتوم", "صعب", "مقطوع", "بالعافيه", "مش قادر", "مش عارف"]],
  [["وشي", "وش", "شفايفي", "شفايف", "لساني", "عيني", "عينيا", "زوري", "رقبتي"], ["ورم", "وارم", "تورم", "منفوخ", "اتنفخ", "اتورم"]],
  [["face", "lips", "tongue", "throat"], ["swell", "swollen"]],
];
const FEVER = ["حرار",  "سخونيه", "سخن", "fever", "temperature", "temp"];

function hasStem(t: string, stems: string[]) {
  return stems.some((w) => t.includes(w));
}
function highFever(t: string) {
  if (!hasStem(t, FEVER)) return false;
  return (t.match(/\d+(?:\s\d)?/g) ?? []).some((n) => { const v = Number(n.replace(" ", ".")); return (v >= 39 && v <= 43) || (v >= 102 && v <= 108); });
}

// Opt-out only when it is clearly about messages: the whole reply, or a fixed phrase ("the pain won't stop" is not an opt-out).
const OPT_OUT_EXACT = ["stop", "unsubscribe", "توقف", "وقف", "بس كده كفايه", "الغاء الاشتراك", "كفايه رسايل"];
const OPT_OUT_PHRASES = ["مش عايز رسايل", "مش عاوز رسايل", "مش عايزه رسايل", "وقف الرسايل", "وقفوا الرسايل", "بطلوا رسايل", "بطلو رسايل", "متبعتوش",
  "متبعتليش", "مش عايز متابعه", "stop messages", "stop messaging", "stop sending", "no more messages", "unsubscribe me"];
const HUMAN = ["عايز اكلم حد", "عاوز اكلم حد", "عايزه اكلم حد", "اكلم موظف", "اكلم حد", "خدمه العملاء", "حد يكلمني", "كلموني", "اتصلوا بيا", "اتصلو بيا", "كلمني",
  "human", "agent", "representative", "call me", "real person", "speak to someone"];
const THANKS = ["شكرا", "متشكر", "متشكره", "تسلم", "تسلمي", "تسلموا", "ربنا يخليك", "ربنا يخليكم", "مرسي", "thanks", "thank you", "thx", "merci"];

export type Safety = { urgent: boolean; selfHarm: boolean; optOut: boolean; human: boolean; thanks: boolean };

export function safety(text: string): Safety {
  const t = normalize(text);
  const selfHarm = hasStem(t, SELF_HARM_STEMS);
  const body = BODY_DANGER.some(([parts, signs]) => hasStem(t, parts) && hasStem(t, signs));
  const urgent = selfHarm || hasStem(t, RED_STEMS) || body || highFever(t);
  const optOut = OPT_OUT_EXACT.includes(t.trim()) || has(t, OPT_OUT_PHRASES);
  return { urgent, selfHarm, optOut, human: has(t, HUMAN), thanks: has(t, THANKS) };
}

const YES = ["1", "yes", "y", "yeah", "yep", "ok", "okay", "sure", "confirm", "confirmed", "اه", "اها", "ايوه", "ايوا", "ايو", "اي", "نعم", "تمام", "اكيد",
  "موافق", "موافقه", "اوكي", "اوك", "ماشي", "حاضر", "طبعا", "اكد", "اكدت", "مواكد", "جاي", "جايه", "هاجي", "هحضر", "اكيد جاي", "ان شاء الله", "اكيد ان شاء الله"];
const NO = ["لا", "لاء", "مش", "no", "nope", "not", "كلا", "لا شكرا"];
const RESCHEDULE = ["تغيير", "غير", "اغير", "نغير", "تاجيل", "اجل", "اجلوا", "ميعاد تاني", "موعد اخر", "موعد تاني", "يوم تاني", "وقت تاني", "reschedule", "change", "postpone", "another time", "another day"];
const CANCEL = ["الغاء", "الغي", "الغيه", "الغوا", "الغو", "cancel", "مش هقدر اجي", "مش هاجي", "مش جاي", "مش هينفع اجي", "مش هعرف اجي", "can t come", "cant come", "won t come"];
const KEEP = ["سيبه", "خليه", "زي ما هو", "keep", "keep it"];
const LATER = ["مش دلوقتي", "بعدين", "مشغول", "مشغوله", "مش فاضي", "مش فاضيه", "later", "busy", "not now"];
const PARTLY = ["احيانا", "ساعات", "مش منتظم", "مش بانتظام", "نص نص", "sometimes", "partly", "not regularly"];
const SIDE = ["اعراض جانبيه", "عرض جانبي", "تعبني", "تعبتني", "تاعبني", "دوخه", "دايخ", "غثيان", "ترجيع", "رجعت", "حساسيه", "هرش", "حكه", "معدتي", "side effect", "side effects", "allergy", "nausea", "dizzy"];
const COST = ["غالي", "غاليه", "سعره", "السعر", "مش لاقيه", "مش لاقيها", "مش موجود", "مش موجوده", "ناقص", "مش متوفر", "expensive", "unavailable", "can t find", "out of stock"];
const FORGOT = ["نسيت", "بنسى", "بنسي", "forgot", "forget"];
const BETTER = ["احسن", "كويس", "كويسه", "اتحسنت", "تحسن", "better", "good", "fine", "improved", "much better", "زي الفل", "تمام"];
const SAME = ["زي ما انا", "زي ما هو", "زي ما هي", "مفيش فرق", "مفيش تغيير", "نفس الحال", "لسه تعبان", "لسه تعبانه", "لسه بيوجعني", "لسه واجعني", "same", "no change", "no difference", "still"];
const WORSE = ["اسوا", "اوحش", "زاد", "زادت", "تعبان اكتر", "تعبانه اكتر", "اتعبت اكتر", "worse", "getting worse"];
const NONE = ["0", "مفيش", "ولا حاجه", "لا مفيش", "كله تمام", "no", "nothing", "none", "nope", "لا", "لاء"];
const ALREADY = ["حجزت", "حاجز", "حاجزه", "already", "booked", "already booked"];
const NOT_NEEDED = ["مش محتاج", "مش محتاجه", "مش لازم", "not needed", "no need", "don t need"];
const COMPLAINT = ["استقبال", "انتظار", "استنيت", "اتاخر", "اتاخرت", "التاخير", "معامله", "سيئه", "سيء", "وحش", "زعلان", "زعلانه", "شكوي", "فاتوره", "حساب",
  "نظافه", "مش محترم", "قله ذوق", "complaint", "rude", "waited", "waiting", "bill", "dirty"];
const CLINICAL = ["وجع", "واجعني", "الم", "تعب", "تعبان", "تعبانه", "دوخه", "حراره", "سخونيه", "كحه", "التهاب", "ورم", "احمرار", "هرش", "حكه", "صداع",
  "اسهال", "امساك", "غثيان", "ترجيع", "ورم", "pain", "fever", "rash", "itch", "dizzy", "nausea", "cough", "swelling", "headache"];

function digitsOf(t: string): string | null {
  const s = t.trim();
  if (/^\d$/.test(s)) return s;
  if (NUMBER_WORDS[s]) return NUMBER_WORDS[s];
  return null;
}

export function ratingOf(text: string): number | null {
  const t = normalize(text);
  const d = digitsOf(t) ?? (t.match(/(?:^|\s)([1-5])(?:\s|$)/)?.[1] ?? null) ?? Object.entries(NUMBER_WORDS).find(([w]) => has(t, [w]))?.[1] ?? null;
  const n = d == null ? NaN : Number(d);
  return n >= 1 && n <= 5 ? n : null;
}

/** What a reply means, given the answers the current question expects. Numbered options map by position. */
export function classify(text: string, expected: Intent[]): Intent {
  const t = normalize(text);
  if (t.trim() === "") return "empty";
  const d = digitsOf(t);
  if (expected.includes("rating")) {
    if (ratingOf(text) != null) return "rating";
  }
  const numbered = expected.filter((e) => !["question", "complaint", "clinical", "text", "rating"].includes(e));
  if (d != null) {
    if (d === "0" && expected.includes("none")) return "none";
    const i = Number(d) - 1;
    if (i >= 0 && i < numbered.length) return numbered[i];
  }
  const want = (i: Intent) => expected.includes(i);
  // A negation or a "but" makes a positive word unreliable ("مش تمام", "مش موافق", "الحمد لله بس لسه تعبان").
  const negated = has(t, ["مش", "مو", "مب", "not", "dont", "don t", "isn t", "no"]) || (has(t, ["لا", "لاء"]) && t.trim().split(" ").length > 1);
  const hedged = has(t, ["بس", "لكن", "but"]);
  // Negated phrases first ("مش كويس" is not "كويس").
  if (want("worse") && has(t, ["مش كويس", "مش كويسه", "مش تمام", "not good", "not well"])) return "worse";
  if (want("same") && has(t, ["مش احسن", "not better"])) return "same";
  if (want("not_needed") && has(t, NOT_NEEDED)) return "not_needed";
  if (want("cancel") && has(t, CANCEL)) return "cancel";
  if (want("later") && has(t, LATER)) return "later";
  if (want("reschedule") && has(t, RESCHEDULE)) return "reschedule";
  if (want("keep") && has(t, KEEP)) return "keep";
  if (want("already") && has(t, ALREADY)) return "already";
  if (want("side_effects") && has(t, SIDE)) return "side_effects";
  if (want("cost") && has(t, COST)) return "cost";
  if (want("forgot") && has(t, FORGOT)) return "forgot";
  if (want("partly") && has(t, PARTLY)) return "partly";
  if (want("worse") && has(t, WORSE)) return "worse";
  if (want("same") && has(t, SAME)) return "same";
  if (want("better") && has(t, BETTER) && !negated && !hedged) return "better";
  if (want("none") && (only(t, NONE) || has(t, ["مفيش", "ولا حاجه", "كله تمام", "nothing"]))) return "none";
  if (want("no") && (only(t, NO) || has(t, ["لا مش", "لا شكرا", "no thanks"]))) return "no";
  if (want("yes") && (only(t, YES) || (!negated && has(t, YES.filter((w) => w.length > 2))))) return "yes";
  if (want("complaint") && has(t, COMPLAINT)) return "complaint";
  if (want("clinical") && has(t, CLINICAL)) return "clinical";
  if (want("question") && (/[?؟]/.test(text) || has(t, ["هو", "هل", "ممكن", "امتي", "فين", "بكام", "كام", "ازاي", "ليه", "what", "when", "where", "how", "can i", "is it"]))) return "question";
  if (want("text") && t.trim().length >= 2) return "text";
  return "unknown";
}
