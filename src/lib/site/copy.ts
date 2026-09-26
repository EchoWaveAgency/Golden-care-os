import type { Lang } from "./api";

// Interface copy only (navigation, labels, legal boilerplate). Medical content comes from the CMS.
const t = {
  ar: {
    brand: "عيادات جولدن كير", promise: "نرعاك لحياة أفضل", tagline: "حيث يلتقي الجمال بالعافية",
    home: "الرئيسية", specialties: "التخصصات", doctors: "الأطباء", offers: "العروض", about: "عن جولدن كير", contact: "تواصل معنا",
    book: "احجز موعدًا", callback: "اطلب اتصالًا", whatsapp: "واتساب", portal: "حساب المريض", staff: "دخول الفريق",
    heroTitle: "رعاية طبية متكاملة في مكان واحد", heroText: "تخصصات متعددة وفريق طبي في مدينة الشروق، بمواعيد واضحة ومتابعة مستمرة لكل مريض.",
    ourSpecialties: "تخصصاتنا", ourDoctors: "فريقنا الطبي", currentOffers: "العروض المعتمدة الحالية", visitUs: "زورونا",
    viewAll: "عرض الكل", viewProfile: "الملف التعريفي", learnMore: "اعرف المزيد", services: "الخدمات", faq: "أسئلة شائعة",
    preparation: "قبل الزيارة", medicalNote: "المعلومات في هذه الصفحة للتثقيف العام ولا تغني عن استشارة الطبيب. يحدد الطبيب مدى ملاءمة أي إجراء بعد الكشف.",
    priceFrom: "السعر", egp: "ج.م", validUntil: "ساري حتى", terms: "الشروط", seatsLeft: "المتاح", regular: "بدلًا من",
    bookTitle: "احجز موعدك", step1: "التخصص", step2: "الطبيب", step3: "الموعد", step4: "بياناتك",
    chooseSpecialty: "اختر التخصص", chooseDoctor: "اختر الطبيب", chooseTime: "اختر الموعد المناسب", noSlots: "لا توجد مواعيد متاحة أونلاين في هذه الأيام. اطلب اتصالًا وسنرتب لك موعدًا.",
    fullName: "الاسم بالكامل", phone: "رقم الموبايل", email: "البريد الإلكتروني (اختياري)", message: "رسالتك (اختياري)",
    consentContact: "أوافق على تواصل جولدن كير معي بخصوص هذا الطلب عبر الهاتف أو واتساب.", consentMarketing: "أوافق على استلام معلومات وعروض من جولدن كير (اختياري).",
    submitBooking: "إرسال طلب الحجز", submitCallback: "اطلب اتصالًا", sending: "جارٍ الإرسال…",
    thanksTitle: "تم استلام طلبك", thanksText: "سيتواصل معك فريق خدمة المرضى لتأكيد الموعد. رقم طلبك:",
    bookingNote: "طلب الحجز لا يُعتبر موعدًا مؤكدًا حتى يتواصل معك فريق خدمة المرضى ويؤكده.",
    address: "العنوان", hours: "مواعيد العمل", openMap: "افتح الخريطة", callUs: "اتصل بنا",
    privacy: "سياسة الخصوصية", termsOfUse: "شروط الاستخدام", apptPolicy: "سياسة المواعيد والإلغاء", commsPolicy: "سياسة الموافقة على التواصل",
    cookiesText: "نستخدم ملفات تعريف الارتباط الضرورية لتشغيل الموقع. نستخدم أدوات القياس والإعلانات فقط بموافقتك.",
    accept: "موافق", reject: "الضرورية فقط", rights: "جميع الحقوق محفوظة",
    langSwitch: "English", specialty: "التخصص", doctor: "الطبيب", anyDoctor: "أي طبيب متاح",
    errors: { generic: "تعذر إرسال الطلب. حاول مرة أخرى أو تواصل معنا عبر واتساب.", phone: "رقم الموبايل غير صحيح.", consent: "يلزم الموافقة على التواصل لإرسال الطلب.", slot: "هذا الموعد لم يعد متاحًا، اختر موعدًا آخر.", rate: "تم استلام طلبات كثيرة من هذا الرقم. سنتواصل معك قريبًا.", name: "من فضلك اكتب الاسم." },
    portalSoon: "حساب المريض قيد التجهيز. للاستفسار عن مواعيدك أو نتائجك تواصل معنا عبر واتساب.",
    endsIn: "ينتهي خلال", days: "يوم", hoursShort: "ساعة",
  },
  en: {
    brand: "Golden Care Clinics", promise: "We care for a better life", tagline: "A place where beauty meets wellness",
    home: "Home", specialties: "Specialties", doctors: "Doctors", offers: "Offers", about: "About", contact: "Contact",
    book: "Book an appointment", callback: "Request a callback", whatsapp: "WhatsApp", portal: "Patient account", staff: "Staff sign-in",
    heroTitle: "Comprehensive medical care under one roof", heroText: "Multiple specialties and a dedicated medical team in El Shorouk, with clear appointments and continuous follow-up for every patient.",
    ourSpecialties: "Our specialties", ourDoctors: "Our medical team", currentOffers: "Current approved offers", visitUs: "Visit us",
    viewAll: "View all", viewProfile: "View profile", learnMore: "Learn more", services: "Services", faq: "Frequently asked questions",
    preparation: "Before your visit", medicalNote: "Information on this page is general education and does not replace a medical consultation. Suitability of any procedure is decided by the doctor after examination.",
    priceFrom: "Price", egp: "EGP", validUntil: "Valid until", terms: "Terms", seatsLeft: "Available", regular: "instead of",
    bookTitle: "Book your appointment", step1: "Specialty", step2: "Doctor", step3: "Time", step4: "Your details",
    chooseSpecialty: "Choose a specialty", chooseDoctor: "Choose a doctor", chooseTime: "Choose a time", noSlots: "No online times on these days. Request a callback and we will arrange one for you.",
    fullName: "Full name", phone: "Mobile number", email: "Email (optional)", message: "Message (optional)",
    consentContact: "I agree that Golden Care may contact me about this request by phone or WhatsApp.", consentMarketing: "I agree to receive information and offers from Golden Care (optional).",
    submitBooking: "Send booking request", submitCallback: "Request a callback", sending: "Sending…",
    thanksTitle: "Your request has been received", thanksText: "Our patient experience team will contact you to confirm. Your reference:",
    bookingNote: "A booking request becomes a confirmed appointment once our patient experience team confirms it with you.",
    address: "Address", hours: "Working hours", openMap: "Open map", callUs: "Call us",
    privacy: "Privacy policy", termsOfUse: "Terms of use", apptPolicy: "Appointment & cancellation policy", commsPolicy: "Communication consent policy",
    cookiesText: "We use essential cookies to run this site. Analytics and advertising tools load only with your consent.",
    accept: "Accept", reject: "Essential only", rights: "All rights reserved",
    langSwitch: "العربية", specialty: "Specialty", doctor: "Doctor", anyDoctor: "Any available doctor",
    errors: { generic: "We couldn't send your request. Please try again or contact us on WhatsApp.", phone: "The mobile number is not valid.", consent: "Consent to be contacted is required to send the request.", slot: "That time is no longer available; please choose another.", rate: "We have received several requests from this number and will contact you shortly.", name: "Please enter your name." },
    portalSoon: "The patient account is being prepared. For appointments or results, contact us on WhatsApp.",
    endsIn: "Ends in", days: "days", hoursShort: "h",
  },
} as const;

export type Copy = (typeof t)["ar"];
export function copy(lang: Lang): Copy {
  return t[lang] as unknown as Copy;
}
export function isLang(v: string): v is Lang {
  return v === "ar" || v === "en";
}
