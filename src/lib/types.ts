import type { AppointmentStatus } from "./appointments";

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "void";

export type PatientRow = {
  id: string; mrn: string; branch_id: string;
  first_name_ar: string; last_name_ar: string; first_name_en: string | null; last_name_en: string | null;
  phone: string; national_id: string | null; date_of_birth: string | null; sex: "female" | "male" | "unknown";
  preferred_channel: string; email: string | null; created_at: string;
};

export type AppointmentRow = {
  id: string; ref: string; slot: string; status: AppointmentStatus; queue_no: number | null;
  patient_id: string; doctor_id: string; channel: string;
  patient?: { id: string; mrn: string; first_name_ar: string; last_name_ar: string; phone: string } | null;
  doctor?: { full_name_ar: string; full_name_en: string | null } | null;
};

export type InvoiceRow = {
  id: string; invoice_no: string | null; branch_id: string; patient_id: string; appointment_id: string | null;
  status: InvoiceStatus; currency: string; subtotal: string; discount_total: string; total: string;
  amount_paid: string; balance: string; issued_at: string | null; created_at: string; issued_by: string | null;
  void_reason: string | null; refunded_total?: string;
};

export type InvoiceLineRow = {
  id: string; service_id: string; doctor_id: string | null; quantity: string; unit_price: string;
  discount: string; line_gross: string; line_total: string;
  service?: { code: string; name_ar: string; name_en: string } | null;
};

export function patientName(p: { first_name_ar: string; last_name_ar: string; first_name_en?: string | null; last_name_en?: string | null } | null | undefined, locale: "ar" | "en") {
  if (!p) return "—";
  if (locale === "en" && p.first_name_en) return `${p.first_name_en} ${p.last_name_en ?? ""}`.trim();
  return `${p.first_name_ar} ${p.last_name_ar}`;
}
