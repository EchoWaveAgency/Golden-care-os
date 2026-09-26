// Field definitions for the website content editor. One generic editor renders every type;
// the database enforces workflow, approvals and publication rules.

export type FieldType = "text" | "slug" | "textarea" | "number" | "datetime" | "date" | "bool" | "specialty" | "staff" | "service" | "offer" | "faq" | "lines";

export type Field = { name: string; ar: string; en: string; type: FieldType; required?: boolean; help_ar?: string; help_en?: string };

export type ContentType = {
  key: "specialties" | "doctors" | "offers" | "landing";
  table: "site_specialty_pages" | "site_doctor_profiles" | "offers" | "landing_pages";
  ar: string;
  en: string;
  titleField: string;
  fields: Field[];
};

const workflowTiming: Field[] = [
  { name: "publish_at", ar: "موعد النشر (اختياري)", en: "Publish at (optional)", type: "datetime" },
];

export const CONTENT_TYPES: ContentType[] = [
  {
    key: "specialties", table: "site_specialty_pages", ar: "صفحات التخصصات", en: "Specialty pages", titleField: "title_ar",
    fields: [
      { name: "specialty_id", ar: "التخصص", en: "Specialty", type: "specialty", required: true },
      { name: "slug", ar: "الرابط", en: "URL slug", type: "slug", required: true, help_ar: "حروف إنجليزية صغيرة وشرطة فقط", help_en: "lowercase letters, digits and dashes" },
      { name: "title_ar", ar: "العنوان (عربي)", en: "Title (Arabic)", type: "text", required: true },
      { name: "title_en", ar: "العنوان (إنجليزي)", en: "Title (English)", type: "text", required: true },
      { name: "summary_ar", ar: "نبذة (عربي)", en: "Summary (Arabic)", type: "textarea" },
      { name: "summary_en", ar: "نبذة (إنجليزي)", en: "Summary (English)", type: "textarea" },
      { name: "body_ar", ar: "المحتوى (عربي)", en: "Body (Arabic)", type: "textarea" },
      { name: "body_en", ar: "المحتوى (إنجليزي)", en: "Body (English)", type: "textarea" },
      { name: "preparation_ar", ar: "تعليمات التحضير (عربي)", en: "Preparation (Arabic)", type: "textarea" },
      { name: "preparation_en", ar: "تعليمات التحضير (إنجليزي)", en: "Preparation (English)", type: "textarea" },
      { name: "faq", ar: "الأسئلة الشائعة", en: "FAQ", type: "faq" },
      { name: "sort_order", ar: "الترتيب", en: "Order", type: "number" },
      { name: "review_due_at", ar: "موعد المراجعة الطبية القادمة", en: "Next medical review", type: "date" },
      ...workflowTiming,
    ],
  },
  {
    key: "doctors", table: "site_doctor_profiles", ar: "ملفات الأطباء", en: "Doctor profiles", titleField: "slug",
    fields: [
      { name: "staff_id", ar: "الطبيب", en: "Doctor", type: "staff", required: true },
      { name: "slug", ar: "الرابط", en: "URL slug", type: "slug", required: true },
      { name: "title_ar", ar: "اللقب المهني (عربي)", en: "Title (Arabic)", type: "text" },
      { name: "title_en", ar: "اللقب المهني (إنجليزي)", en: "Title (English)", type: "text" },
      { name: "bio_ar", ar: "نبذة (عربي)", en: "Bio (Arabic)", type: "textarea" },
      { name: "bio_en", ar: "نبذة (إنجليزي)", en: "Bio (English)", type: "textarea" },
      { name: "qualifications_ar", ar: "المؤهلات (عربي)", en: "Qualifications (Arabic)", type: "textarea" },
      { name: "qualifications_en", ar: "المؤهلات (إنجليزي)", en: "Qualifications (English)", type: "textarea" },
      { name: "photo_url", ar: "رابط الصورة", en: "Photo URL", type: "text" },
      { name: "accepts_online_booking", ar: "يقبل الحجز الأونلاين", en: "Accepts online booking", type: "bool" },
      { name: "sort_order", ar: "الترتيب", en: "Order", type: "number" },
      ...workflowTiming,
    ],
  },
  {
    key: "offers", table: "offers", ar: "العروض والباقات", en: "Offers & packages", titleField: "title_ar",
    fields: [
      { name: "slug", ar: "الرابط", en: "URL slug", type: "slug", required: true },
      { name: "specialty_id", ar: "التخصص", en: "Specialty", type: "specialty" },
      { name: "service_id", ar: "الخدمة", en: "Service", type: "service", required: true },
      { name: "title_ar", ar: "اسم العرض (عربي)", en: "Title (Arabic)", type: "text", required: true },
      { name: "title_en", ar: "اسم العرض (إنجليزي)", en: "Title (English)", type: "text", required: true },
      { name: "summary_ar", ar: "وصف (عربي)", en: "Summary (Arabic)", type: "textarea" },
      { name: "summary_en", ar: "وصف (إنجليزي)", en: "Summary (English)", type: "textarea" },
      { name: "price", ar: "سعر العرض المعتمد", en: "Approved offer price", type: "number", required: true },
      { name: "regular_price", ar: "السعر المعتاد (إن كان صحيحًا)", en: "Regular price (if valid)", type: "number" },
      { name: "starts_at", ar: "يبدأ", en: "Starts", type: "datetime", required: true },
      { name: "ends_at", ar: "ينتهي", en: "Ends", type: "datetime", required: true },
      { name: "capacity", ar: "العدد المتاح", en: "Capacity", type: "number" },
      { name: "terms_ar", ar: "الشروط والاستثناءات وسياسة الإلغاء (عربي)", en: "Terms (Arabic)", type: "textarea", required: true },
      { name: "terms_en", ar: "الشروط (إنجليزي)", en: "Terms (English)", type: "textarea", required: true },
      { name: "disclaimer_ar", ar: "تنبيه طبي (عربي)", en: "Medical disclaimer (Arabic)", type: "textarea" },
      { name: "disclaimer_en", ar: "تنبيه طبي (إنجليزي)", en: "Medical disclaimer (English)", type: "textarea" },
      ...workflowTiming,
    ],
  },
  {
    key: "landing", table: "landing_pages", ar: "صفحات الحملات", en: "Landing pages", titleField: "campaign_name",
    fields: [
      { name: "slug", ar: "الرابط", en: "URL slug", type: "slug", required: true },
      { name: "campaign_name", ar: "اسم الحملة", en: "Campaign name", type: "text", required: true },
      { name: "specialty_id", ar: "التخصص", en: "Specialty", type: "specialty" },
      { name: "offer_id", ar: "العرض المرتبط", en: "Linked offer", type: "offer" },
      { name: "title_ar", ar: "العنوان (عربي)", en: "Title (Arabic)", type: "text", required: true },
      { name: "title_en", ar: "العنوان (إنجليزي)", en: "Title (English)", type: "text", required: true },
      { name: "hero_ar", ar: "الجملة الرئيسية (عربي)", en: "Hero line (Arabic)", type: "textarea" },
      { name: "hero_en", ar: "الجملة الرئيسية (إنجليزي)", en: "Hero line (English)", type: "textarea" },
      { name: "body_ar", ar: "المحتوى (عربي)", en: "Body (Arabic)", type: "textarea" },
      { name: "body_en", ar: "المحتوى (إنجليزي)", en: "Body (English)", type: "textarea" },
      { name: "benefits", ar: "المزايا المعتمدة (سطر لكل ميزة)", en: "Approved benefits (one per line)", type: "lines" },
      { name: "faq", ar: "الأسئلة الشائعة", en: "FAQ", type: "faq" },
      { name: "starts_at", ar: "يبدأ", en: "Starts", type: "datetime" },
      { name: "ends_at", ar: "ينتهي", en: "Ends", type: "datetime" },
      { name: "show_countdown", ar: "عداد تنازلي (يتطلب تاريخ انتهاء حقيقي)", en: "Countdown (needs a real end date)", type: "bool" },
      ...workflowTiming,
    ],
  },
];

export function contentType(key: string) {
  return CONTENT_TYPES.find((c) => c.key === key);
}

export type Faq = { q_ar: string; a_ar: string; q_en: string; a_en: string };

/** FAQ text format: blocks separated by a blank line; first line = question, rest = answer. */
export function parseFaqBlocks(text: string): { q: string; a: string }[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const [q, ...rest] = b.split("\n");
      return { q: q.trim(), a: rest.join("\n").trim() };
    })
    .filter((x) => x.q);
}

export function faqFromText(ar: string, en: string): Faq[] {
  const a = parseFaqBlocks(ar);
  const e = parseFaqBlocks(en);
  return Array.from({ length: Math.max(a.length, e.length) }, (_, i) => ({
    q_ar: a[i]?.q ?? "", a_ar: a[i]?.a ?? "", q_en: e[i]?.q ?? "", a_en: e[i]?.a ?? "",
  }));
}

export function faqToText(faq: Faq[] | null | undefined, lang: "ar" | "en"): string {
  return (faq ?? []).map((f) => `${lang === "ar" ? f.q_ar : f.q_en}\n${lang === "ar" ? f.a_ar : f.a_en}`.trim()).join("\n\n");
}

export type Benefit = { ar: string; en: string };
export function benefitsFromText(ar: string, en: string): Benefit[] {
  const a = ar.split("\n").map((s) => s.trim()).filter(Boolean);
  const e = en.split("\n").map((s) => s.trim()).filter(Boolean);
  return Array.from({ length: Math.max(a.length, e.length) }, (_, i) => ({ ar: a[i] ?? "", en: e[i] ?? "" }));
}

export const STATUS_FLOW: Record<string, { to: string; perm: string; ar: string; en: string; needsNote?: boolean }[]> = {
  draft: [
    { to: "medical_review", perm: "content.edit", ar: "إرسال للمراجعة الطبية", en: "Send to medical review" },
    { to: "marketing_review", perm: "content.edit", ar: "إرسال لمراجعة التسويق", en: "Send to marketing review" },
  ],
  medical_review: [
    { to: "marketing_review", perm: "content.medical_approve", ar: "اعتماد طبي", en: "Medically approve" },
    { to: "draft", perm: "content.medical_approve", ar: "إعادة للتعديل", en: "Send back", needsNote: true },
  ],
  marketing_review: [
    { to: "approved", perm: "content.marketing_approve", ar: "اعتماد تسويقي", en: "Marketing approve" },
    { to: "draft", perm: "content.marketing_approve", ar: "إعادة للتعديل", en: "Send back", needsNote: true },
  ],
  approved: [
    { to: "published", perm: "content.publish", ar: "نشر", en: "Publish" },
    { to: "draft", perm: "content.publish", ar: "إعادة للمسودة", en: "Back to draft" },
  ],
  scheduled: [{ to: "archived", perm: "content.publish", ar: "أرشفة", en: "Archive" }],
  published: [{ to: "archived", perm: "content.publish", ar: "إيقاف النشر (أرشفة)", en: "Unpublish (archive)" }],
  archived: [{ to: "draft", perm: "content.edit", ar: "إعادة فتح كمسودة", en: "Reopen as draft" }],
};

export const STATUS_LABEL: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  medical_review: { ar: "مراجعة طبية", en: "Medical review" },
  marketing_review: { ar: "مراجعة التسويق", en: "Marketing review" },
  approved: { ar: "معتمد", en: "Approved" },
  scheduled: { ar: "مجدول", en: "Scheduled" },
  published: { ar: "منشور", en: "Published" },
  archived: { ar: "مؤرشف", en: "Archived" },
};
