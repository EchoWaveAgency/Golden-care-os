import type { Lang } from "./api";

// Starter texts. MUST be reviewed by Golden Care's legal counsel before launch (OPEN_QUESTIONS.md).
type Doc = { title: string; sections: [string, string][] };
export const LEGAL: Record<"privacy" | "terms" | "appointment" | "communication", Record<Lang, Doc>> = {
  privacy: {
    ar: { title: "سياسة الخصوصية", sections: [
      ["البيانات التي نجمعها", "نجمع البيانات التي تقدمها عند طلب موعد أو اتصال: الاسم ورقم الموبايل والبريد الإلكتروني الاختياري وتفاصيل طلبك. لا نطلب أي بيانات طبية عبر نماذج الموقع."],
      ["كيف نستخدمها", "نستخدم بياناتك للتواصل معك بخصوص طلبك وتنظيم موعدك. لا نستخدمها لأغراض تسويقية إلا بموافقتك الصريحة."],
      ["المشاركة", "لا نبيع بياناتك. قد نشارك بيانات محدودة مع مقدمي خدمات يعملون لصالحنا (مثل خدمات الرسائل والاستضافة) وفق عقود تلزمهم بحمايتها."],
      ["ملفات تعريف الارتباط", "نستخدم ملفات ضرورية لتشغيل الموقع. أدوات القياس والإعلانات لا تعمل إلا بعد موافقتك، ولا تتلقى أي بيانات تعرّفك أو تتعلق بحالتك الصحية."],
      ["حقوقك", "يمكنك طلب الاطلاع على بياناتك أو تصحيحها أو سحب موافقتك على التواصل التسويقي في أي وقت عبر التواصل معنا."],
      ["الحماية", "نحمي البيانات بضوابط وصول صارمة وتشفير أثناء النقل وسجل تدقيق لكل عملية."],
    ] },
    en: { title: "Privacy policy", sections: [
      ["Data we collect", "When you request an appointment or a callback we collect your name, mobile number, optional email and request details. Our website forms never ask for medical information."],
      ["How we use it", "To contact you about your request and arrange your appointment. We use it for marketing only with your explicit consent."],
      ["Sharing", "We do not sell your data. Limited data may be shared with service providers acting for us (such as messaging and hosting) under contracts that require its protection."],
      ["Cookies", "Essential cookies run the site. Analytics and advertising tools load only after your consent and never receive information that identifies you or relates to your health."],
      ["Your rights", "You may ask to access or correct your data, or withdraw marketing consent at any time, by contacting us."],
      ["Security", "We protect data with strict access controls, encryption in transit and an audit trail of every action."],
    ] },
  },
  terms: {
    ar: { title: "شروط الاستخدام", sections: [
      ["المحتوى الطبي", "المعلومات على الموقع للتثقيف العام ولا تغني عن الكشف والاستشارة الطبية. لا يمثل أي محتوى وعدًا بنتيجة علاجية."],
      ["الحجز", "طلب الحجز عبر الموقع لا يصبح موعدًا مؤكدًا إلا بعد تأكيده من فريق خدمة المرضى."],
      ["العروض", "تخضع العروض لشروطها المنشورة ومدة سريانها والعدد المتاح، ويحدد الطبيب مدى ملاءمة أي إجراء بعد الكشف."],
      ["الاستخدام المقبول", "يُمنع إرسال بيانات غير صحيحة أو بيانات شخص آخر دون تفويض، أو محاولة الوصول لأجزاء غير مصرح بها من الموقع."],
    ] },
    en: { title: "Terms of use", sections: [
      ["Medical content", "Website information is general education and does not replace examination and medical advice. No content promises a treatment result."],
      ["Booking", "A booking request becomes a confirmed appointment only after our patient experience team confirms it."],
      ["Offers", "Offers are subject to their published terms, validity period and availability. The doctor decides suitability of any procedure after examination."],
      ["Acceptable use", "Do not submit false information or another person's data without authorization, or attempt to access unauthorized parts of the site."],
    ] },
  },
  appointment: {
    ar: { title: "سياسة المواعيد والإلغاء", sections: [
      ["تأكيد الموعد", "يتواصل معك فريق خدمة المرضى لتأكيد طلب الحجز. يصلك تأكيد بالموعد ورقم مرجعي."],
      ["التأخير", "يرجى الحضور قبل الموعد بعشر دقائق. في حال التأخير قد يُعاد جدولة الموعد حسب جدول الطبيب."],
      ["الإلغاء وإعادة الجدولة", "نرجو إبلاغنا بالإلغاء أو التغيير في أقرب وقت ممكن حتى نتيح الموعد لمريض آخر. تُحدد سياسة المبالغ المدفوعة مقدمًا في شروط كل خدمة أو عرض."],
    ] },
    en: { title: "Appointment & cancellation policy", sections: [
      ["Confirmation", "Our patient experience team contacts you to confirm your request. You receive a confirmation with the time and a reference number."],
      ["Lateness", "Please arrive ten minutes early. If you are late, the appointment may be rescheduled according to the doctor's schedule."],
      ["Cancelling or rescheduling", "Please let us know as early as possible so the time can be offered to another patient. Treatment of prepaid amounts is set in each service's or offer's terms."],
    ] },
  },
  communication: {
    ar: { title: "سياسة الموافقة على التواصل", sections: [
      ["التواصل الخاص بطلبك", "بموافقتك عند إرسال النموذج، نتواصل معك عبر الهاتف أو واتساب بخصوص طلبك ومواعيدك فقط."],
      ["التواصل التسويقي", "لا نرسل عروضًا أو معلومات تسويقية إلا إذا وافقت على ذلك بشكل منفصل، ويمكنك إلغاء موافقتك في أي وقت."],
      ["الرسائل الطبية", "لا نرسل نتائج أو معلومات طبية عبر قنوات غير مؤمنة. يتم ذلك عبر حساب المريض أو في العيادة."],
    ] },
    en: { title: "Communication consent policy", sections: [
      ["About your request", "With the consent you give on the form, we contact you by phone or WhatsApp about your request and appointments only."],
      ["Marketing", "We send offers or marketing information only if you separately agree, and you can withdraw at any time."],
      ["Medical information", "We do not send results or medical information through unsecured channels; this happens through the patient account or at the clinic."],
    ] },
  },
};
