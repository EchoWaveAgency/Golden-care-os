// What the assistant says. Warm, short, clearly automated, never medical advice.
// WhatsApp openers are approved templates (message_templates, same wording); everything else is a session reply.
// Voice wording avoids "send 1/2/3" and emoji. Wording to be signed off by the medical director and patient relations.

export type Lang = "ar" | "en";
export type Channel = "whatsapp" | "voice";
export type Vars = Record<string, string | number | null | undefined>;
type Line = { ar: string; en: string; voice_ar?: string; voice_en?: string };

export const TEMPLATE_FOR: Record<string, string> = {
  open_booking_confirm: "care_booking_confirm", open_pre_visit: "care_pre_visit", open_post_visit: "care_post_visit",
  open_followup: "care_followup", nudge: "care_nudge",
};

export const SCRIPTS: Record<string, Line> = {
  open_booking_confirm: {
    ar: "أهلًا {{name}} 👋 معاك مساعد جولدن كير الآلي. حجزك مع {{doctor}} يوم {{date}} الساعة {{time}}. تحب تأكد الحضور؟ ابعت 1 للتأكيد، 2 لتغيير الموعد، 3 للإلغاء.",
    en: "Hello {{name}} 👋 this is the Golden Care automated assistant. Your appointment with {{doctor}} is on {{date}} at {{time}}. Reply 1 to confirm, 2 to change it, 3 to cancel.",
    voice_ar: "حجز حضرتك مع {{doctor}} يوم {{date}} الساعة {{time}}. تحب تأكد الحضور؟ قول أيوه للتأكيد، أو تغيير لو عايز ميعاد تاني، أو إلغاء.",
    voice_en: "Your appointment with {{doctor}} is on {{date}} at {{time}}. Would you like to confirm? Say yes to confirm, change for another time, or cancel.",
  },
  open_pre_visit: {
    ar: "أهلًا {{name}} 🌿 بنفكرك بموعدك بكرة {{date}} الساعة {{time}} مع {{doctor}} في عيادات جولدن كير. ابعت 1 لو جاي، 2 لو محتاج تغيّر الموعد، 3 للإلغاء.",
    en: "Hello {{name}} 🌿 a reminder of your appointment tomorrow {{date}} at {{time}} with {{doctor}} at Golden Care Clinics. Reply 1 if you are coming, 2 to change it, 3 to cancel.",
    voice_ar: "بنفكر حضرتك بموعدك بكرة الساعة {{time}} مع {{doctor}}. هتقدر تيجي؟ قول أيوه، أو تغيير، أو إلغاء.",
    voice_en: "A reminder of your appointment tomorrow at {{time}} with {{doctor}}. Will you be able to come? Say yes, change, or cancel.",
  },
  open_post_visit: {
    ar: "أهلًا {{name}} 🌷 معاك مساعد جولدن كير الآلي. بنطمن على حضرتك بعد زيارتك مع {{doctor}}. عندك دقيقة لـ ٣ أسئلة سريعة؟ ابعت 1 أيوه، 2 مش دلوقتي.",
    en: "Hello {{name}} 🌷 this is the Golden Care automated assistant, checking on you after your visit with {{doctor}}. Do you have a minute for 3 quick questions? Reply 1 yes, 2 not now.",
    voice_ar: "بنطمن على حضرتك بعد زيارتك مع {{doctor}}. ينفع أسألك تلات أسئلة سريعة؟ قول أيوه، أو مش دلوقتي.",
    voice_en: "We are checking on you after your visit with {{doctor}}. May I ask three quick questions? Say yes, or not now.",
  },
  open_followup: {
    ar: "أهلًا {{name}} 👋 {{doctor}} طلب متابعة لحضرتك يوم {{due}}. تحب نحجزلك الموعد؟ ابعت 1 أيوه، 2 حجزت بالفعل، 3 مش محتاج.",
    en: "Hello {{name}} 👋 {{doctor}} asked for a follow-up visit on {{due}}. Shall we book it for you? Reply 1 yes, 2 already booked, 3 not needed.",
    voice_ar: "{{doctor}} طلب متابعة لحضرتك يوم {{due}}. تحب نحجزلك الموعد؟ قول أيوه، أو حجزت، أو مش محتاج.",
    voice_en: "{{doctor}} asked for a follow-up visit on {{due}}. Shall we book it for you? Say yes, already booked, or not needed.",
  },
  nudge: {
    ar: "أهلًا {{name}}، لسه مستنيين ردك على رسالتنا السابقة من عيادات جولدن كير 🙏 ردك بيساعدنا نخدمك أحسن.",
    en: "Hello {{name}}, we are still waiting for your reply to our previous Golden Care message 🙏 it helps us look after you.",
  },
  voice_identify: {
    ar: "", en: "",
    voice_ar: "ألو، أهلًا بحضرتك. معاك مساعد جولدن كير الآلي. أنا بكلم {{name}}؟",
    voice_en: "Hello, this is the Golden Care automated assistant. Am I speaking with {{name}}?",
  },
  voice_wrong_person: {
    ar: "", en: "",
    voice_ar: "آسفين جدًا على الإزعاج، هنحاول نتواصل معاه في وقت تاني. يومك سعيد.",
    voice_en: "Sorry for the trouble, we will try again another time. Have a good day.",
  },
  voice_silence_end: {
    ar: "", en: "",
    voice_ar: "مش سامع حضرتك كويس، هنتواصل معاك في وقت تاني. مع السلامة.",
    voice_en: "I could not hear you well, we will contact you another time. Goodbye.",
  },
  confirmed: {
    ar: "تمام يا {{name}} ✅ اتأكد حجزك. ياريت توصل قبل الميعاد بـ ١٠ دقايق ومعاك أي تحاليل أو أشعة قديمة. مستنيينك 🌷",
    en: "Thank you {{name}} ✅ your appointment is confirmed. Please arrive 10 minutes early and bring any previous tests or scans. See you soon 🌷",
    voice_ar: "تمام، اتأكد حجزك. ياريت توصل قبل الميعاد بعشر دقايق ومعاك أي تحاليل أو أشعة قديمة. مستنيينك، مع السلامة.",
    voice_en: "Your appointment is confirmed. Please arrive ten minutes early and bring any previous tests. See you soon, goodbye.",
  },
  reschedule_ack: {
    ar: "ولا يهمك 🙏 حد من خدمة العملاء هيكلمك قريب يختار معاك ميعاد يناسبك. ولو تحب تحجز بنفسك ممكن من حسابك على بوابة جولدن كير.",
    en: "No problem 🙏 someone from patient services will call you soon to choose a time that suits you. You can also book from your Golden Care account.",
    voice_ar: "ولا يهمك، حد من خدمة العملاء هيكلمك قريب يختار معاك ميعاد يناسبك. مع السلامة.",
    voice_en: "No problem, someone from patient services will call you soon to choose a new time. Goodbye.",
  },
  cancel_check: {
    ar: "تحب نلغي الموعد خالص، ولا نغيّره لميعاد تاني؟ ابعت 1 إلغاء، 2 تغيير الموعد، 3 سيبه زي ما هو.",
    en: "Would you like to cancel, or move it to another time? Reply 1 cancel, 2 change the time, 3 keep it.",
    voice_ar: "تحب نلغي الموعد، ولا نغيّره لميعاد تاني، ولا نسيبه زي ما هو؟",
    voice_en: "Would you like to cancel, change the time, or keep the appointment?",
  },
  cancelled_ack: {
    ar: "تم إلغاء الموعد. ألف سلامة عليك 🌷 ولو حبيت تحجز تاني إحنا موجودين في أي وقت.",
    en: "Your appointment has been cancelled. Take care 🌷 we are here whenever you want to book again.",
    voice_ar: "تم إلغاء الموعد. ألف سلامة عليك، ولو حبيت تحجز تاني إحنا موجودين. مع السلامة.",
    voice_en: "Your appointment has been cancelled. Take care, we are here whenever you need us. Goodbye.",
  },
  kept_ack: {
    ar: "تمام، الموعد زي ما هو ✅ مستنيينك.", en: "Great, the appointment stays as it is ✅ see you soon.",
    voice_ar: "تمام، الموعد زي ما هو. مستنيينك، مع السلامة.", voice_en: "Great, the appointment stays as it is. See you soon, goodbye.",
  },
  reask_confirm: {
    ar: "معلش مفهمتش ردك 🙏 ابعت 1 للتأكيد، 2 لتغيير الموعد، 3 للإلغاء.",
    en: "Sorry, I did not understand 🙏 reply 1 to confirm, 2 to change the time, 3 to cancel.",
    voice_ar: "معلش مسمعتش كويس. تحب تأكد الحضور؟ قول أيوه، أو تغيير، أو إلغاء.",
    voice_en: "Sorry, I did not catch that. Would you like to confirm? Say yes, change, or cancel.",
  },
  reask_generic: {
    ar: "معلش مفهمتش ردك 🙏 ممكن تختار رقم من الاختيارات؟", en: "Sorry, I did not understand 🙏 could you choose one of the numbers?",
    voice_ar: "معلش مسمعتش كويس، ممكن تعيد تاني؟", voice_en: "Sorry, I did not catch that, could you say it again?",
  },
  question_forwarded: {
    ar: "سؤالك وصل لفريق خدمة العملاء وهيردوا عليك في أقرب وقت 🙏", en: "Your question has been passed to our patient services team, who will reply soon 🙏",
    voice_ar: "سؤالك وصل لفريق خدمة العملاء وهيردوا عليك في أقرب وقت.", voice_en: "Your question has been passed to our team, who will reply soon.",
  },
  handoff: {
    ar: "هخلي حد من فريقنا يتواصل معاك بنفسه في أقرب وقت 🙏", en: "I will ask someone from our team to contact you personally soon 🙏",
    voice_ar: "هخلي حد من فريقنا يكلمك بنفسه في أقرب وقت. مع السلامة.", voice_en: "Someone from our team will call you personally soon. Goodbye.",
  },
  later_ack: {
    ar: "ولا يهمك، هتواصل معاك في وقت تاني إن شاء الله 🌷", en: "No problem, I will get back to you a bit later 🌷",
    voice_ar: "ولا يهمك، هنكلمك في وقت تاني إن شاء الله. مع السلامة.", voice_en: "No problem, we will call you later. Goodbye.",
  },
  declined_ack: {
    ar: "تمام، ألف سلامة عليك 🌷 ولو احتجت أي حاجة إحنا موجودين{{phone_part}}.", en: "Of course. Take care 🌷 we are here if you need anything{{phone_part}}.",
    voice_ar: "تمام، ألف سلامة عليك. مع السلامة.", voice_en: "Of course, take care. Goodbye.",
  },
  ask_meds: {
    ar: "بتاخد العلاج اللي الدكتور كتبه بانتظام؟ ابعت 1 أيوه، 2 أحيانًا، 3 لأ.", en: "Are you taking the treatment the doctor prescribed regularly? Reply 1 yes, 2 sometimes, 3 no.",
    voice_ar: "بتاخد العلاج اللي الدكتور كتبه بانتظام؟ قول أيوه، أو أحيانًا، أو لأ.", voice_en: "Are you taking the prescribed treatment regularly? Say yes, sometimes, or no.",
  },
  ask_meds_why: {
    ar: "ممكن نعرف السبب؟ ابعت 1 أعراض جانبية، 2 العلاج غالي أو مش لاقيه، 3 نسيت، أو اكتب السبب.",
    en: "May we know why? Reply 1 side effects, 2 too expensive or not available, 3 I forgot, or type the reason.",
    voice_ar: "ممكن نعرف السبب؟ أعراض جانبية، ولا العلاج غالي أو مش لاقيه، ولا نسيت؟",
    voice_en: "May I ask why? Side effects, cost or availability, or did you forget?",
  },
  side_effects_ack: {
    ar: "شكرًا إنك قلتلنا 🙏 بلّغت الدكتور وهيتواصل معاك. ولو حسيت بضيق نفس أو تورم في الوش أو الشفايف أو طفح شديد روح أقرب طوارئ فورًا.",
    en: "Thank you for telling us 🙏 I have informed your doctor, who will contact you. If you have breathing difficulty, swelling of the face or lips, or a severe rash, go to the nearest emergency department now.",
    voice_ar: "شكرًا إنك قلتلنا. بلّغت الدكتور وهيتواصل معاك. ولو حسيت بضيق نفس أو تورم في الوش روح أقرب طوارئ فورًا.",
    voice_en: "Thank you. I have informed your doctor, who will contact you. If you have breathing difficulty or face swelling, go to the emergency department now.",
  },
  cost_ack: {
    ar: "فهمتك 🙏 بلّغت الدكتور عشان يشوف معاك بديل مناسب، وحد من فريقنا هيتواصل معاك.", en: "I understand 🙏 I have told your doctor so they can look at a suitable alternative, and our team will contact you.",
  },
  forgot_tip: {
    ar: "بتحصل لينا كلنا 😊 ممكن تعمل منبّه على الموبايل في مواعيد العلاج. ولو فاتتك جرعة اسأل الدكتور أو الصيدلي تعمل إيه.",
    en: "It happens to all of us 😊 a phone alarm at medicine times can help. If you miss a dose, ask your doctor or pharmacist what to do.",
    voice_ar: "بتحصل لينا كلنا. ممكن تعمل منبّه على الموبايل في مواعيد العلاج، ولو فاتتك جرعة اسأل الدكتور أو الصيدلي.",
    voice_en: "It happens to all of us. A phone alarm can help, and if you miss a dose, ask your doctor or pharmacist.",
  },
  noted: {
    ar: "تمام، سجلت ده وهيوصل للدكتور 🙏", en: "Thank you, I have noted this for your doctor 🙏",
    voice_ar: "تمام، سجلت ده وهيوصل للدكتور.", voice_en: "Thank you, I have noted this for your doctor.",
  },
  ask_improve: {
    ar: "حاسس بتحسن من ساعة الزيارة؟ ابعت 1 أحسن، 2 زي ما أنا، 3 أسوأ.", en: "Do you feel better since your visit? Reply 1 better, 2 the same, 3 worse.",
    voice_ar: "حاسس بتحسن من ساعة الزيارة؟ أحسن، ولا زي ما انت، ولا أسوأ؟", voice_en: "Do you feel better since your visit? Better, the same, or worse?",
  },
  glad: { ar: "الحمد لله، فرّحتنا 🌷", en: "That is great to hear 🌷", voice_ar: "الحمد لله، فرّحتنا.", voice_en: "That is great to hear." },
  same_ack: {
    ar: "إن شاء الله تتحسن قريب 🙏 هبلّغ الدكتور بردك.", en: "We hope you feel better soon 🙏 I will let your doctor know.",
    voice_ar: "إن شاء الله تتحسن قريب. هبلّغ الدكتور بردك.", voice_en: "We hope you feel better soon. I will let your doctor know.",
  },
  worse_ack: {
    ar: "سلامتك 🙏 بلّغت الدكتور وهيتواصل معاك النهارده. لو الأعراض شديدة أو بتزيد بسرعة روح أقرب طوارئ أو اتصل بالإسعاف 123.",
    en: "Sorry to hear that 🙏 I have informed your doctor, who will contact you today. If symptoms are severe or getting worse quickly, go to the nearest emergency department or call 123.",
    voice_ar: "سلامتك. بلّغت الدكتور وهيتواصل معاك النهارده. لو الأعراض شديدة روح أقرب طوارئ أو اتصل بالإسعاف مية تلاتة وعشرين.",
    voice_en: "Sorry to hear that. I have informed your doctor, who will contact you today. If symptoms are severe, go to the emergency department or call one two three.",
  },
  ask_problems: {
    ar: "فيه أي حاجة تانية مضايقاك أو أي مشكلة قابلتك معانا؟ اكتبها، أو ابعت 0 لو مفيش.", en: "Is anything else bothering you, or did you have any problem with us? Type it, or reply 0 if nothing.",
    voice_ar: "فيه أي حاجة تانية مضايقاك أو أي مشكلة قابلتك معانا؟ قولها، أو قول مفيش.", voice_en: "Is anything else bothering you, or did you have any problem with us? Tell me, or say nothing.",
  },
  complaint_ack: {
    ar: "متأسفين جدًا على اللي حصل 🙏 سجلنا ملاحظتك وحد من خدمة العملاء هيتواصل معاك بنفسه.", en: "We are very sorry about that 🙏 we have recorded it and someone from patient services will contact you personally.",
    voice_ar: "متأسفين جدًا على اللي حصل. سجلنا ملاحظتك وحد من خدمة العملاء هيكلمك.", voice_en: "We are very sorry about that. Someone from patient services will contact you.",
  },
  ask_rating: {
    ar: "آخر سؤال: من 1 لـ 5 تقيّم زيارتك قد إيه؟ (5 ممتاز)", en: "Last question: from 1 to 5, how would you rate your visit? (5 is excellent)",
    voice_ar: "آخر سؤال، من واحد لخمسة تقيّم زيارتك قد إيه؟", voice_en: "Last question, from one to five, how would you rate your visit?",
  },
  rating_high: { ar: "شكرًا جدًا 🌟 ده بيسعدنا.", en: "Thank you so much 🌟", voice_ar: "شكرًا جدًا، ده بيسعدنا.", voice_en: "Thank you so much." },
  rating_low: {
    ar: "شكرًا لصراحتك 🙏 حد من الإدارة هيتواصل معاك عشان نعرف نحسّن إيه.", en: "Thank you for being honest 🙏 a manager will contact you so we can improve.",
    voice_ar: "شكرًا لصراحتك، حد من الإدارة هيتواصل معاك عشان نحسّن خدمتنا.", voice_en: "Thank you for being honest, a manager will contact you so we can improve.",
  },
  ask_followup_offer: {
    ar: "الدكتور طلب متابعة يوم {{due}}. تحب نحجزلك؟ ابعت 1 أيوه، 2 هحجز بنفسي.", en: "Your doctor asked for a follow-up on {{due}}. Shall we book it? Reply 1 yes, 2 I will book myself.",
    voice_ar: "الدكتور طلب متابعة يوم {{due}}. تحب نحجزلك؟", voice_en: "Your doctor asked for a follow-up on {{due}}. Shall we book it for you?",
  },
  followup_booking_ack: {
    ar: "تمام 👍 حد من الاستقبال هيكلمك يأكد معاك ميعاد المتابعة.", en: "Great 👍 reception will call you to confirm the follow-up time.",
    voice_ar: "تمام، حد من الاستقبال هيكلمك يأكد معاك ميعاد المتابعة.", voice_en: "Great, reception will call you to confirm the follow-up time.",
  },
  followup_self_ack: {
    ar: "تمام، تقدر تحجز من بوابة جولدن كير أو تكلمنا. متنساش ميعاد المتابعة يوم {{due}} 🌷", en: "Sure, you can book from your Golden Care account or call us. Please do not miss your follow-up on {{due}} 🌷",
    voice_ar: "تمام، متنساش ميعاد المتابعة يوم {{due}}.", voice_en: "Sure, please do not miss your follow-up on {{due}}.",
  },
  followup_already: { ar: "ممتاز 👌 مستنيينك في الميعاد.", en: "Excellent 👌 see you then.", voice_ar: "ممتاز، مستنيينك في الميعاد. مع السلامة.", voice_en: "Excellent, see you then. Goodbye." },
  ask_followup_why: {
    ar: "تمام، ممكن نعرف السبب عشان نبلّغ الدكتور؟", en: "Of course. May we know why, so we can let your doctor know?",
    voice_ar: "تمام، ممكن نعرف السبب عشان نبلّغ الدكتور؟", voice_en: "Of course. May I ask why, so I can let your doctor know?",
  },
  goodbye: {
    ar: "ألف سلامة عليك يا {{name}} 🌷 ولو احتجت أي حاجة إحنا موجودين{{phone_part}}.", en: "Take care {{name}} 🌷 we are here if you need anything{{phone_part}}.",
    voice_ar: "ألف سلامة عليك، ولو احتجت أي حاجة إحنا موجودين. مع السلامة.", voice_en: "Take care, and we are here if you need anything. Goodbye.",
  },
  emergency: {
    ar: "سلامتك 🙏 لو الحالة طارئة اتصل بالإسعاف 123 أو روح أقرب طوارئ فورًا. بلّغت الفريق الطبي حالًا وهيتواصلوا معاك على الرقم ده.",
    en: "Please take care 🙏 if this is an emergency call an ambulance on 123 or go to the nearest emergency department now. I have alerted our medical team and they will contact you on this number.",
    voice_ar: "سلامتك. لو الحالة طارئة اتصل بالإسعاف مية تلاتة وعشرين أو روح أقرب طوارئ فورًا. بلّغت الفريق الطبي وهيكلموك حالًا.",
    voice_en: "If this is an emergency call one two three or go to the nearest emergency department now. I have alerted our medical team, who will call you right away.",
  },
  crisis: {
    ar: "إحنا جنبك 🙏 لو حاسس إنك ممكن تأذي نفسك اتصل بالإسعاف 123 أو بالخط الساخن للدعم النفسي {{crisis_line}} دلوقتي. بلّغت فريقنا الطبي وهيكلمك حالًا.",
    en: "We are here for you 🙏 if you feel you might harm yourself, please call 123 or the psychological support hotline {{crisis_line}} now. I have alerted our medical team, who will call you right away.",
    voice_ar: "إحنا جنبك. لو حاسس إنك ممكن تأذي نفسك اتصل بالإسعاف مية تلاتة وعشرين أو بالخط الساخن للدعم النفسي {{crisis_line}} دلوقتي. بلّغت فريقنا الطبي وهيكلمك حالًا.",
    voice_en: "We are here for you. If you feel you might harm yourself, please call one two three or the support hotline {{crisis_line}} now. Our medical team will call you right away.",
  },
  emergency_after_hours: {
    ar: "سلامتك 🙏 لو الحالة طارئة اتصل بالإسعاف 123 أو روح أقرب طوارئ فورًا — متستناش. العيادة مقفولة دلوقتي؛ بلّغت الفريق الطبي وهيتواصلوا معاك أول ما يبدأ الدوام.",
    en: "Please take care 🙏 if this is an emergency call 123 or go to the nearest emergency department now — do not wait. The clinic is closed now; I have alerted our medical team, who will contact you when they are back.",
    voice_ar: "سلامتك. لو الحالة طارئة اتصل بالإسعاف مية تلاتة وعشرين أو روح أقرب طوارئ فورًا. العيادة مقفولة دلوقتي، والفريق الطبي هيتواصل معاك أول ما يبدأ الدوام.",
    voice_en: "If this is an emergency call one two three or go to the emergency department now. The clinic is closed; our team will contact you when they are back.",
  },
  crisis_after_hours: {
    ar: "إحنا جنبك 🙏 لو حاسس إنك ممكن تأذي نفسك اتصل دلوقتي بالإسعاف 123 أو بالخط الساخن للدعم النفسي {{crisis_line}} — شغال ٢٤ ساعة. بلّغت فريقنا الطبي وهيتواصلوا معاك أول ما يبدأ الدوام.",
    en: "We are here for you 🙏 if you feel you might harm yourself, call 123 or the psychological support hotline {{crisis_line}} now — it is open 24 hours. Our medical team will contact you as soon as they are back.",
    voice_ar: "إحنا جنبك. لو حاسس إنك ممكن تأذي نفسك اتصل دلوقتي بالإسعاف مية تلاتة وعشرين أو بالخط الساخن للدعم النفسي {{crisis_line}}، شغال أربعة وعشرين ساعة.",
    voice_en: "We are here for you. If you feel you might harm yourself, call one two three or the support hotline {{crisis_line}} now, it is open 24 hours.",
  },
  appointment_changed: {
    ar: "شكرًا لردك 🙏 الموعد ده اتغيّر أو اتلغى من عندنا، وحد من الاستقبال هيتواصل معاك يأكد معاك المعاد الصح.",
    en: "Thank you 🙏 this appointment has been changed or cancelled on our side; reception will contact you to confirm the right time.",
    voice_ar: "شكرًا لردك. الموعد ده اتغيّر من عندنا، وحد من الاستقبال هيكلمك يأكد المعاد الصح. مع السلامة.",
    voice_en: "Thank you. This appointment changed on our side; reception will call you to confirm the right time. Goodbye.",
  },
  cancel_request_ack: {
    ar: "وصلنا طلب الإلغاء 🙏 لأن الموعد قريب، حد من الاستقبال هيتواصل معاك يأكد الإلغاء أو يغيّر الميعاد.",
    en: "We have your cancellation request 🙏 as the appointment is soon, reception will contact you to confirm the cancellation or change the time.",
    voice_ar: "وصلنا طلب الإلغاء. لأن الموعد قريب، حد من الاستقبال هيكلمك يأكد الإلغاء أو يغيّر الميعاد. مع السلامة.",
    voice_en: "We have your cancellation request. As the appointment is soon, reception will call you to confirm. Goodbye.",
  },
  opted_out: {
    ar: "تمام، مش هنبعتلك رسائل متابعة تاني 🙏 ولو احتجت أي حاجة إحنا موجودين.", en: "Understood, we will not send you follow-up messages again 🙏 we are here if you need us.",
    voice_ar: "تمام، مش هنتواصل معاك تاني للمتابعة. مع السلامة.", voice_en: "Understood, we will not contact you again for follow-ups. Goodbye.",
  },
  human_handoff: {
    ar: "أكيد 🙏 حد من فريقنا هيتواصل معاك بنفسه في أقرب وقت.", en: "Of course 🙏 someone from our team will contact you personally soon.",
    voice_ar: "أكيد، حد من فريقنا هيكلمك بنفسه في أقرب وقت. مع السلامة.", voice_en: "Of course, someone from our team will call you personally soon. Goodbye.",
  },
  no_audio: {
    ar: "معلش 🙏 مقدرش أسمع الرسائل الصوتية. ممكن تكتبلي ردك؟ ولو محتاج حد يكلمك ابعت «كلمني».",
    en: "Sorry 🙏 I cannot listen to voice notes. Could you type your reply? If you would like a call, send \"call me\".",
  },
  no_media: {
    ar: "وصلتني الصورة/الملف 🙏 الفريق هيطلع عليه. ممكن تكتبلي ردك على السؤال؟",
    en: "Thank you, our team will look at the file 🙏 could you type your reply to the question?",
  },
  welcome: { ar: "العفو 🌷 إحنا في الخدمة دايمًا.", en: "You are welcome 🌷 always here for you." },
  received_will_contact: {
    ar: "شكرًا لتواصلك مع عيادات جولدن كير 🙏 رسالتك وصلت وحد من الفريق هيرد عليك قريب.",
    en: "Thank you for contacting Golden Care Clinics 🙏 your message has reached our team, who will reply soon.",
  },
};

/** Psychological support hotline (Ministry of Health, 24 hours). Configurable; to be confirmed by the medical director. */
export const CRISIS_LINE = process.env.CARE_CRISIS_LINE || "16328";

export function render(key: string, channel: Channel, lang: Lang, vars: Vars): string {
  const line = SCRIPTS[key];
  vars = { crisis_line: CRISIS_LINE, ...vars };
  if (!line) throw new Error(`unknown script ${key}`);
  const raw = channel === "voice" ? (lang === "en" ? line.voice_en ?? line.en : line.voice_ar ?? line.ar) : lang === "en" ? line.en : line.ar;
  return raw.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  }).trim();
}
