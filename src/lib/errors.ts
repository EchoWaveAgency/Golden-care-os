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
  { match: /permission denied|row-level security|42501/, ar: "ليست لديك صلاحية لتنفيذ هذا الإجراء.", en: "You do not have permission to do this." },
];

export function friendlyError(message: string | undefined | null, locale: Locale): string {
  const text = message ?? "";
  const rule = RULES.find((r) => r.match.test(text));
  if (rule) return locale === "ar" ? rule.ar : rule.en;
  return locale === "ar" ? "حدث خطأ غير متوقع. لم يُحفظ شيء." : "Something went wrong. Nothing was saved.";
}
