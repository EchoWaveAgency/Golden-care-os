import type { Locale } from "./i18n";

// Maps database errors (raised by constraints, triggers and RPCs) to clear bilingual
// messages for staff. Unknown errors fall back to a safe generic message; the original
// text is kept for logs, never shown raw.

type Rule = { match: RegExp; ar: string; en: string };

const RULES: Rule[] = [
  { match: /no_doctor_overlap/, ar: "الطبيب لديه موعد آخر في هذا الوقت.", en: "The doctor already has an appointment at this time." },
  { match: /no_room_overlap/, ar: "الغرفة محجوزة في هذا الوقت.", en: "The room is already booked at this time." },
  { match: /invalid phone number/, ar: "رقم الموبايل غير صحيح.", en: "The mobile number is not valid." },
  { match: /patients_national_id_uq|duplicate key.*national_id/, ar: "هذا الرقم القومي مسجل لمريض آخر.", en: "This national ID belongs to another patient." },
  { match: /national_id_check|check constraint "patients_national_id/, ar: "الرقم القومي يجب أن يكون 14 رقمًا.", en: "National ID must be 14 digits." },
  { match: /invalid appointment transition/, ar: "لا يمكن نقل الموعد إلى هذه الحالة من حالته الحالية.", en: "The appointment cannot move to that status from its current one." },
  { match: /cancel reason is required/, ar: "سبب الإلغاء مطلوب.", en: "A cancellation reason is required." },
  { match: /open a cashier session/, ar: "افتح وردية خزينة قبل استلام النقدية.", en: "Open a cashier session before receiving cash." },
  { match: /already have an open cashier session/, ar: "لديك وردية مفتوحة بالفعل.", en: "You already have an open session." },
  { match: /requires a reference/, ar: "طريقة الدفع هذه تتطلب رقم مرجع.", en: "This payment method requires a reference number." },
  { match: /exceeds outstanding balance/, ar: "المبلغ أكبر من المتبقي على الفاتورة.", en: "The amount exceeds the invoice balance." },
  { match: /cannot receive payments/, ar: "هذه الفاتورة لا تقبل دفعات في حالتها الحالية.", en: "This invoice cannot receive payments in its current status." },
  { match: /idempotency key reused/, ar: "تعارض في تسجيل الدفعة. أعد تحميل الصفحة وحاول مجددًا.", en: "Payment conflict. Reload the page and try again." },
  { match: /invoice has no lines/, ar: "أضف خدمة واحدة على الأقل قبل الإصدار.", en: "Add at least one service before issuing." },
  { match: /discount_within_line/, ar: "الخصم أكبر من قيمة البند.", en: "The discount exceeds the line value." },
  { match: /separation of duties/, ar: "لا يمكن لنفس المستخدم الذي أصدر الفاتورة إلغاؤها. يلزم موافقة مستخدم آخر.", en: "The user who issued the invoice cannot void it; another authorized user must." },
  { match: /only issued invoices with no payments/, ar: "لا يمكن إلغاء فاتورة عليها دفعات. يلزم استرداد أولًا.", en: "Invoices with payments cannot be voided; refund first." },
  { match: /void reason is required|reason is required/, ar: "السبب مطلوب.", en: "A reason is required." },
  { match: /note is required when counted cash differs/, ar: "يوجد فرق في النقدية. اكتب ملاحظة توضح السبب.", en: "Counted cash differs from expected. Add a note explaining why." },
  { match: /signed encounter cannot be modified/, ar: "الكشف موقّع ولا يمكن تعديله. أضف ملاحظة لاحقة.", en: "The encounter is signed. Add an addendum instead." },
  { match: /only the treating doctor/, ar: "التوقيع متاح للطبيب المعالج فقط.", en: "Only the treating doctor can sign." },
  { match: /no open fiscal period/, ar: "الفترة المحاسبية مغلقة أو غير معرفة لهذا التاريخ.", en: "No open fiscal period for this date." },
  { match: /is not configured/, ar: "إعدادات الحسابات غير مكتملة. تواصل مع رئيس الحسابات.", en: "Accounting settings are incomplete. Contact the chief accountant." },
  { match: /allergy acknowledgement required/, ar: "المريض لديه حساسية مسجلة. راجعها وأكّد الإقرار قبل التوقيع.", en: "The patient has a recorded allergy. Review it and confirm the acknowledgement before signing." },
  { match: /restricted medicine/, ar: "هذا الدواء ضمن القائمة المقيدة ويتطلب صلاحية خاصة.", en: "This medicine is on the restricted list and needs special authorization." },
  { match: /prescription has no items/, ar: "أضف دواءً واحدًا على الأقل.", en: "Add at least one medicine." },
  { match: /signed prescriptions cannot be changed/, ar: "الروشتة موقّعة ولا يمكن تعديلها.", en: "The prescription is signed and cannot be changed." },
  { match: /patient-facing summary is required/, ar: "اكتب ملخصًا مبسطًا للمريض قبل الإفراج.", en: "Write a patient-facing summary before releasing." },
  { match: /only signed records can be released/, ar: "يجب توقيع السجل أولًا.", en: "Sign the record first." },
  { match: /already released/, ar: "تم الإفراج عنه بالفعل.", en: "Already released." },
  { match: /evidence of relationship is required/, ar: "اكتب مستند إثبات صلة القرابة أو الولاية.", en: "Record the evidence of relationship or guardianship." },
  { match: /resolution note is required/, ar: "اكتب ما تم لحل الطلب قبل إغلاقه.", en: "Write the resolution before closing." },
  { match: /only failed messages can be retried/, ar: "يمكن إعادة المحاولة للرسائل الفاشلة فقط.", en: "Only failed messages can be retried." },
  { match: /permission denied|row-level security|42501/, ar: "ليست لديك صلاحية لتنفيذ هذا الإجراء.", en: "You do not have permission to do this." },
];

export function friendlyError(message: string | undefined | null, locale: Locale): string {
  const text = message ?? "";
  const rule = RULES.find((r) => r.match.test(text));
  if (rule) return locale === "ar" ? rule.ar : rule.en;
  return locale === "ar" ? "حدث خطأ غير متوقع. لم يُحفظ شيء." : "Something went wrong. Nothing was saved.";
}

// Patient-facing wording for the portal (never reveals whether another file exists).
const PORTAL_RULES: Rule[] = [
  { match: /no longer available/, ar: "هذا الموعد لم يعد متاحًا. اختر وقتًا آخر.", en: "That time is no longer available. Please choose another." },
  { match: /too many pending requests/, ar: "لديك 3 طلبات حجز بانتظار التأكيد. سنتواصل معك قريبًا.", en: "You already have 3 booking requests awaiting confirmation. We will contact you soon." },
  { match: /online cancellation closes/, ar: "الإلغاء من الحساب غير متاح قبل الموعد مباشرة. تواصل معنا عبر واتساب أو الهاتف.", en: "Online cancellation is closed this close to the appointment. Please contact us by WhatsApp or phone." },
  { match: /can no longer be cancelled online/, ar: "لا يمكن إلغاء هذا الموعد من الحساب.", en: "This appointment can no longer be cancelled online." },
  { match: /too many requests/, ar: "وصلت للحد اليومي للطلبات. حاول غدًا أو تواصل معنا.", en: "You have reached today's request limit. Try tomorrow or contact us." },
  { match: /survey already submitted/, ar: "تم إرسال تقييمك لهذه الزيارة من قبل. شكرًا لك.", en: "You already rated this visit. Thank you." },
  { match: /survey is available after the visit/, ar: "التقييم متاح بعد انتهاء الزيارة.", en: "Rating is available after the visit." },
  { match: /no matching patient file/, ar: "لم نجد ملفًا بهذا الرقم ورقم الموبايل معًا. تأكد من البيانات.", en: "No file matches that number and mobile together. Please check the details." },
  { match: /check constraint|violates|invalid input/, ar: "تأكد من البيانات المدخلة.", en: "Please check the details you entered." },
  { match: /not found|permission denied|42501/, ar: "هذا الإجراء غير متاح لحسابك.", en: "This action is not available for your account." },
];

export function portalError(message: string | undefined | null, lang: Locale): string {
  const text = message ?? "";
  const rule = PORTAL_RULES.find((r) => r.match.test(text));
  if (rule) return lang === "ar" ? rule.ar : rule.en;
  return lang === "ar" ? "حدث خطأ غير متوقع. حاول مرة أخرى." : "Something went wrong. Please try again.";
}
