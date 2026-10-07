import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import type { Lang } from "./site/api";

// Patient portal context. Patients never read tables directly: everything goes through the
// portal_* database functions, which check the signed-in account and any family grant.

export type PortalCard = { id: string; mrn: string; first_name_ar: string; last_name_ar: string; first_name_en: string | null; last_name_en: string | null };
export type FamilyCard = PortalCard & { level: "appointments" | "full"; relation: string; expires_at: string | null };
export type PortalMe = {
  patient: PortalCard & { phone: string; email: string | null; preferred_channel: string; emergency_name: string | null; emergency_phone: string | null };
  family: FamilyCard[];
  shared_with: { grant_id: string; name: string; level: string; relation: string; expires_at: string | null }[];
  consents: Record<string, boolean>;
};

export const PORTAL_FOR_COOKIE = "gc_portal_for";

export function cardName(p: PortalCard, lang: Lang) {
  return lang === "en" && p.first_name_en ? `${p.first_name_en} ${p.last_name_en ?? ""}`.trim() : `${p.first_name_ar} ${p.last_name_ar}`;
}

export const getPortal = cache(async (lang: Lang) => {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${lang}/portal`);
  const { data } = await supabase.rpc("portal_me");
  const me = data as PortalMe | null;
  if (!me) redirect(`/${lang}/portal?account=none`);
  // Acting for a family member only if a live grant exists (the database re-checks every call).
  const wanted = cookies().get(PORTAL_FOR_COOKIE)?.value;
  const other = me.family.find((f) => f.id === wanted);
  const active = other ?? { ...me.patient, level: "full" as const, relation: "self", expires_at: null };
  return { supabase, me, active, isSelf: !other, full: active.level === "full", lang, ar: lang === "ar" };
});

export type Portal = Awaited<ReturnType<typeof getPortal>>;

export const RELATION: Record<string, [string, string]> = {
  self: ["أنا", "Me"], parent: ["ولي أمر", "Parent"], child: ["ابن / ابنة", "Child"], spouse: ["زوج / زوجة", "Spouse"],
  guardian: ["وصي", "Guardian"], caregiver: ["مرافق", "Caregiver"], other: ["أخرى", "Other"],
};

export const APT_STATUS: Record<string, [string, string, string]> = {
  requested: ["بانتظار التأكيد", "Awaiting confirmation", "pending_confirmation"],
  pending_confirmation: ["بانتظار التأكيد", "Awaiting confirmation", "pending_confirmation"],
  booked: ["محجوز", "Booked", "booked"], confirmed: ["مؤكد", "Confirmed", "confirmed"],
  arrived: ["وصلت", "Checked in", "arrived"], waiting: ["في الانتظار", "Waiting", "waiting"],
  in_consultation: ["في الكشف", "In consultation", "in_consultation"], procedure_in_progress: ["جلسة جارية", "In session", "in_consultation"],
  awaiting_payment: ["بانتظار الدفع", "Awaiting payment", "awaiting_payment"], completed: ["تمت", "Completed", "completed"],
  canceled: ["ملغي", "Cancelled", "canceled"], no_show: ["لم يحضر", "Missed", "no_show"],
};

export const INV_STATUS: Record<string, [string, string]> = {
  issued: ["غير مدفوعة", "Unpaid"], partially_paid: ["مدفوعة جزئيًا", "Partly paid"], paid: ["مدفوعة", "Paid"], void: ["ملغاة", "Void"],
};

export type PortalAppointment = { id: string; ref: string; start: string; end: string; status: string; doctor_ar: string; doctor_en: string;
  specialty_ar: string; specialty_en: string; can_cancel: boolean; can_survey: boolean };
export type PortalRx = { id: string; ref: string; date: string; notes: string | null; doctor_ar: string; doctor_en: string;
  items: { drug: string; strength: string | null; form: string | null; dose: string; frequency: string; duration: string | null; instructions: string | null }[] };
export type PortalMedical = {
  visits: { id: string; date: string; summary: string; instructions: string | null; released_at: string; doctor_ar: string; doctor_en: string; specialty_ar: string; specialty_en: string }[];
  prescriptions: PortalRx[]; allergies: string[];
};
export type PortalFinance = { balance: number; wallet?: number; loyalty?: { points: number; value: number; referral_code: string | null; referral_bonus: number | null } | null; invoices: { id: string; invoice_no: string; issued_at: string; status: string; total: number; paid: number; balance: number; discount: number;
  lines: { service_ar: string; service_en: string; qty: number; net: number }[] | null;
  receipts: { receipt_no: string; amount: number; method: string; at: string }[] | null;
  refunded?: number; refunds?: { ref: string; amount: number; method: string; at: string }[] | null }[] };
