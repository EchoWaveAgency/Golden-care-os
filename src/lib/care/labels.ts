// Bilingual labels for the care assistant screens.
type L = Record<string, { ar: string; en: string }>;

export const CARE_KIND: L = {
  booking_confirm: { ar: "تأكيد حجز", en: "Booking confirmation" },
  pre_visit: { ar: "تذكير قبل الموعد", en: "Day-before reminder" },
  post_visit: { ar: "متابعة بعد الزيارة", en: "After-visit follow-up" },
  followup: { ar: "تذكير بموعد المتابعة", en: "Follow-up visit reminder" },
};
export const CARE_STATUS: L = {
  scheduled: { ar: "مجدولة", en: "Scheduled" }, waiting: { ar: "بانتظار رد المريض", en: "Waiting for the patient" },
  human: { ar: "مع فريق العمل", en: "With staff" }, completed: { ar: "مكتملة", en: "Completed" },
  no_response: { ar: "لم يرد", en: "No response" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
  failed: { ar: "تعذر الوصول", en: "Unreachable" }, opted_out: { ar: "رفض المتابعة", en: "Opted out" },
};
export const CARE_OUTCOME: L = {
  confirmed: { ar: "أكد الحضور", en: "Confirmed" }, cancelled: { ar: "ألغى الموعد", en: "Cancelled" },
  reschedule_requested: { ar: "طلب تغيير الموعد", en: "Asked to reschedule" }, answered: { ar: "أجاب على المتابعة", en: "Answered" },
  partial: { ar: "أجاب جزئيًا", en: "Partly answered" }, declined: { ar: "اعتذر", en: "Declined" }, urgent: { ar: "علامات خطر", en: "Danger signs" },
  handed_off: { ar: "حُوّل لموظف", en: "Handed to staff" }, no_response: { ar: "لم يرد", en: "No response" },
  booking_requested: { ar: "طلب حجز المتابعة", en: "Asked to book the follow-up" }, says_booked: { ar: "قال إنه حجز", en: "Says already booked" },
  opted_out: { ar: "رفض المتابعة", en: "Opted out" }, wrong_person: { ar: "رد شخص آخر", en: "Someone else answered" },
  unreachable: { ar: "تعذر الوصول", en: "Unreachable" }, call_ended: { ar: "انتهت المكالمة", en: "Call ended" },
  already_confirmed: { ar: "مؤكد من الاستقبال", en: "Already confirmed at the desk" }, appointment_changed: { ar: "تغير الموعد", en: "Appointment changed" },
  already_booked: { ar: "حجز المتابعة بالفعل", en: "Follow-up already booked" }, too_late: { ar: "فات الوقت", en: "Too late" },
  closed_by_staff: { ar: "أغلقها موظف", en: "Closed by staff" }, date_changed: { ar: "تغير موعد المتابعة", en: "Follow-up date changed" },
  followup_cancelled: { ar: "أُلغيت المتابعة", en: "Follow-up cancelled" }, cancel_requested: { ar: "طلب الإلغاء (داخل المهلة)", en: "Asked to cancel (inside the window)" }, expired: { ar: "انتهى موعدها", en: "Expired" },
};
export const SEVERITY: L = {
  urgent: { ar: "عاجل جدًا", en: "Urgent" }, high: { ar: "مهم", en: "High" }, normal: { ar: "عادي", en: "Normal" }, low: { ar: "للعلم", en: "For information" },
};
export const CATEGORY: L = {
  clinical: { ar: "طبي", en: "Clinical" }, medication: { ar: "العلاج", en: "Medication" }, complaint: { ar: "شكوى", en: "Complaint" },
  booking: { ar: "حجز", en: "Booking" }, other: { ar: "أخرى", en: "Other" },
};
export const ANSWER: L = {
  yes: { ar: "منتظم", en: "Regular" }, partly: { ar: "أحيانًا", en: "Sometimes" }, no: { ar: "لا يأخذه", en: "Not taking it" },
  better: { ar: "أحسن", en: "Better" }, same: { ar: "زي ما هو", en: "Same" }, worse: { ar: "أسوأ", en: "Worse" },
  side_effects: { ar: "أعراض جانبية", en: "Side effects" }, cost: { ar: "السعر/التوفر", en: "Cost / availability" }, forgot: { ar: "نسيان", en: "Forgot" }, other: { ar: "سبب آخر", en: "Other" },
};

export const lbl = (map: L, key: string | null | undefined, ar: boolean) => (key ? (map[key] ? (ar ? map[key].ar : map[key].en) : key) : "");

/** Assistant-written summaries are stored as "عربي / English"; show the viewer's language. */
export const pick = (text: string | null | undefined, ar: boolean) => {
  if (!text) return "";
  const i = text.indexOf(" / ");
  return i < 0 ? text : ar ? text.slice(0, i) : text.slice(i + 3);
};
