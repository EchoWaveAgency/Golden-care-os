"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { clinicLocalToIso, slotRange } from "@/lib/format";
import { APPOINTMENT_STATUSES } from "@/lib/appointments";
import type { FormState } from "@/components/FormMessage";

const BookInput = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  minutes: z.coerce.number().int().min(5).max(240),
  channel: z.enum(["front_desk", "phone", "whatsapp", "website", "portal", "social", "referral", "walk_in"]),
  idempotency_key: z.string().min(10),
  notes_admin: z.string().trim().max(500).optional(),
  device_id: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export async function bookAppointment(_prev: FormState, form: FormData): Promise<FormState> {
  const ctx = await getContext();
  const parsed = BookInput.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: ctx.locale === "ar" ? "راجع بيانات الموعد." : "Check the appointment details." };
  const v = parsed.data;

  const { data: doctor } = await ctx.supabase.from("staff").select("id, branch_id, specialty_id").eq("id", v.doctor_id).single();
  if (!doctor?.specialty_id) return { error: friendlyError(null, ctx.locale) };

  const { error } = await ctx.supabase.from("appointments").insert({
    branch_id: doctor.branch_id,
    patient_id: v.patient_id,
    doctor_id: v.doctor_id,
    specialty_id: doctor.specialty_id,
    slot: slotRange(clinicLocalToIso(v.date, v.time), v.minutes),
    channel: v.channel,
    status: "booked",
    idempotency_key: v.idempotency_key,
    notes_admin: v.notes_admin || null,
    device_id: v.device_id || null,
  });
  // A duplicate idempotency key means this exact submission already succeeded.
  if (error && !/appointments_idempotency_key_key/.test(error.message)) {
    return { error: friendlyError(error.message, ctx.locale) };
  }
  revalidatePath("/os/reception");
  redirect(`/os/patients/${v.patient_id}?booked=1`);
}

export async function transitionAppointment(form: FormData) {
  const ctx = await getContext();
  const id = String(form.get("id") ?? "");
  const to = String(form.get("to") ?? "");
  const reason = String(form.get("reason") ?? "").trim() || null;
  const back = String(form.get("back") ?? "/os/reception");
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(to)) return;
  const { error } = await ctx.supabase.rpc("transition_appointment", { p_id: id, p_to: to, p_reason: reason });
  revalidatePath(back);
  if (error) redirect(`${back}?error=${encodeURIComponent(friendlyError(error.message, ctx.locale))}`);
  redirect(back);
}
