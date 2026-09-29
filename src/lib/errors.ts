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
  { match: /refund reason is required/, ar: "اكتب سبب الاسترداد.", en: "Enter the reason for the refund." },
  { match: /exceeds the refundable amount/, ar: "المبلغ أكبر من المتاح للاسترداد على هذه الفاتورة.", en: "The amount exceeds what can be refunded on this invoice." },
  { match: /cannot approve your own refund/, ar: "لا يمكنك الموافقة على طلب استرداد قدّمته بنفسك. يلزم مسؤول آخر.", en: "You cannot approve a refund you requested; another approver is required." },
  { match: /note is required to reject/, ar: "اكتب سبب الرفض.", en: "Write the reason for rejecting." },
  { match: /must be approved before payment/, ar: "يجب اعتماد الاسترداد قبل صرفه.", en: "The refund must be approved before it is paid." },
  { match: /open a cashier session before paying cash/, ar: "افتح وردية خزينة قبل صرف نقدية.", en: "Open a cashier session before paying out cash." },
  { match: /refund already/, ar: "تم اتخاذ قرار في هذا الطلب بالفعل.", en: "This request has already been decided." },
  { match: /your own roles/, ar: "لا يمكنك تعديل صلاحياتك بنفسك.", en: "You cannot change your own roles." },
  { match: /your own account/, ar: "لا يمكنك إيقاف حسابك بنفسك.", en: "You cannot deactivate your own account." },
  { match: /already active for the user/, ar: "هذا الدور مفعّل للمستخدم بالفعل.", en: "This role is already active for the user." },
  { match: /end date must be in the future/, ar: "تاريخ الانتهاء يجب أن يكون في المستقبل.", en: "The end date must be in the future." },
  { match: /cannot approve a settlement you prepared/, ar: "لا يمكنك اعتماد كشف أعددته بنفسك. يلزم مسؤول آخر.", en: "You cannot approve a statement you prepared; another approver is required." },
  { match: /contract you entered/, ar: "لا يمكنك اعتماد كشف مبني على عقد أدخلته بنفسك.", en: "You cannot approve a statement based on a contract you entered." },
  { match: /approver cannot also record the payment/, ar: "من اعتمد الكشف لا يسجل صرفه. يلزم شخص آخر.", en: "The approver cannot also record the payment." },
  { match: /contract changed after this statement/, ar: "تغيّر العقد بعد إعداد الكشف. ألغِه وأعد إعداده.", en: "The contract changed after this statement was prepared. Cancel and prepare again." },
  { match: /without a contract/, ar: "في الكشف خدمات لطبيب بدون عقد سارٍ. أضف العقد ثم ألغِ الكشف وأعد إعداده.", en: "The statement has services with no valid contract. Add the contract, cancel and prepare again." },
  { match: /settlement_one_active_run|duplicate key.*settlement/, ar: "يوجد كشف لهذا الطبيب عن نفس الشهر بالفعل.", en: "A statement for this doctor and month already exists." },
  { match: /cannot settle a future month/, ar: "لا يمكن إعداد كشف لشهر لم يبدأ.", en: "You cannot settle a month that has not started." },
  { match: /only draft settlements can be cancelled/, ar: "يمكن إلغاء الكشوف غير المعتمدة فقط.", en: "Only draft statements can be cancelled." },
  { match: /must be approved before payment/, ar: "يجب اعتماد الكشف قبل الصرف.", en: "The statement must be approved before payment." },
  { match: /nothing to pay on this settlement/, ar: "لا يوجد مبلغ مستحق للصرف في هذا الكشف (يُرحّل الرصيد السالب).", en: "Nothing to pay on this statement (a negative balance is carried)." },
  { match: /settlement for this period is already approved/, ar: "يوجد كشف معتمد في هذه الفترة؛ يجب أن يبدأ العقد الجديد بعده.", en: "A statement for this period is approved; the new contract must start after it." },
  { match: /contract already starts on this date/, ar: "يوجد عقد يبدأ في نفس التاريخ.", en: "A contract already starts on this date." },
  { match: /used in an approved settlement/, ar: "هذا العقد استُخدم في كشف معتمد ولا يمكن تعديله. ابدأ عقدًا جديدًا.", en: "This contract was used in an approved statement. Start a new contract instead." },
  { match: /mandatory for privileged roles/, ar: "التحقق الثنائي إلزامي للأدوار الحساسة.", en: "Two-factor sign-in is mandatory for privileged roles." },
  { match: /own sign-in security/, ar: "لا يمكنك تعديل إعدادات دخولك بنفسك.", en: "You cannot change your own sign-in security." },
  { match: /insufficient stock for (\S+)/, ar: "الكمية المتاحة (غير المنتهية الصلاحية) لا تكفي لأحد الأصناف.", en: "Not enough usable (unexpired) stock for one of the items." },
  { match: /controlled item/, ar: "هذا الصنف خاضع للرقابة ويتطلب صلاحية خاصة للصرف.", en: "This is a controlled item and needs special authorization." },
  { match: /expiry date is required/, ar: "تاريخ انتهاء الصلاحية مطلوب لهذا الصنف.", en: "An expiry date is required for this item." },
  { match: /already expired/, ar: "لا يمكن استلام صنف منتهي الصلاحية.", en: "Expired goods cannot be received." },
  { match: /lot number is required/, ar: "رقم التشغيلة مطلوب.", en: "The lot number is required." },
  { match: /supplier invoice number is required/, ar: "رقم فاتورة المورد مطلوب.", en: "The supplier invoice number is required." },
  { match: /goods_receipts_supplier_id_supplier_invoice_no_key/, ar: "فاتورة المورد هذه مسجلة من قبل.", en: "This supplier invoice was already received." },
  { match: /choose the appointment or write the purpose/, ar: "اختر الموعد أو اكتب سبب الصرف.", en: "Choose the appointment or write the purpose of the issue." },
  { match: /a count is already open/, ar: "يوجد جرد مفتوح لهذا المخزن.", en: "A count is already open for this store." },
  { match: /enter a counted quantity for every lot/, ar: "أدخل الكمية المعدودة لكل تشغيلة.", en: "Enter a counted quantity for every lot." },
  { match: /approve your own count/, ar: "لا يمكنك اعتماد جرد قمت به. يلزم مسؤول آخر.", en: "You cannot approve your own count; another approver is required." },
  { match: /stock moved after the count/, ar: "تغيّر الرصيد بعد تقديم الجرد. ألغِه وأعد الجرد.", en: "Stock moved after the count was submitted. Cancel and count again." },
  { match: /count is in progress for this store/, ar: "يوجد جرد مفتوح لهذا المخزن؛ لا صرف ولا استلام حتى يُعتمد أو يُلغى.", en: "A count is in progress for this store; no issues or receipts until it is approved or cancelled." },
  { match: /too many decimals/, ar: "عدد الخانات العشرية أكبر من المسموح (الكمية 3، التكلفة 4).", en: "Too many decimals (quantity 3, cost 4)." },
  { match: /controlled-items authority/, ar: "تغيير تصنيف الصنف أو خضوعه للرقابة يتطلب صلاحية الأصناف الخاضعة للرقابة (المدير الطبي).", en: "Changing an item's category or controlled status needs the controlled-items authority (medical director)." },
  { match: /add at least one line/, ar: "أضف صنفًا واحدًا على الأقل.", en: "Add at least one line." },
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
  { match: /nothing to pay/, ar: "لا يوجد مبلغ مستحق على هذه الفاتورة.", en: "There is nothing to pay on this invoice." },
  { match: /check constraint|violates|invalid input/, ar: "تأكد من البيانات المدخلة.", en: "Please check the details you entered." },
  { match: /not found|permission denied|42501/, ar: "هذا الإجراء غير متاح لحسابك.", en: "This action is not available for your account." },
];

export function portalError(message: string | undefined | null, lang: Locale): string {
  const text = message ?? "";
  const rule = PORTAL_RULES.find((r) => r.match.test(text));
  if (rule) return lang === "ar" ? rule.ar : rule.en;
  return lang === "ar" ? "حدث خطأ غير متوقع. حاول مرة أخرى." : "Something went wrong. Please try again.";
}
