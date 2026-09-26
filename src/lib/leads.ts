// Patient-experience wording: people are patients and inquiries, never "sales opportunities".
export const LEAD_STATUS: Record<string, { ar: string; en: string }> = {
  inquiry: { ar: "استفسار جديد", en: "New inquiry" },
  contacted: { ar: "تم التواصل", en: "Contacted" },
  qualified: { ar: "تم فهم الاحتياج", en: "Needs understood" },
  appointment_requested: { ar: "طلب موعد", en: "Appointment requested" },
  appointment_confirmed: { ar: "موعد مؤكد", en: "Appointment confirmed" },
  arrived: { ar: "حضر", en: "Arrived" },
  visit_completed: { ar: "اكتملت الزيارة", en: "Visit completed" },
  follow_up_completed: { ar: "اكتملت المتابعة", en: "Follow-up completed" },
  closed: { ar: "مغلق", en: "Closed" },
};
export const LEAD_KIND: Record<string, { ar: string; en: string }> = {
  booking: { ar: "طلب حجز", en: "Booking request" },
  callback: { ar: "طلب اتصال", en: "Callback" },
  inquiry: { ar: "استفسار", en: "Inquiry" },
};
