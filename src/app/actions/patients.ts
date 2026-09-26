"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { toWesternDigits } from "@/lib/format";

export type PatientFormState =
  | { error?: string; duplicates?: { patient_id: string; mrn: string; full_name: string; phone: string; match_reason: string }[] }
  | undefined;

const optional = z.string().trim().transform((v) => (v === "" ? null : v)).nullable().optional();

const PatientInput = z.object({
  first_name_ar: z.string().trim().min(1).max(80),
  last_name_ar: z.string().trim().min(1).max(80),
  first_name_en: optional,
  last_name_en: optional,
  phone_raw: z.string().trim().min(6).max(30),
  national_id: optional.refine((v) => v == null || /^\d{14}$/.test(v), "national_id"),
  date_of_birth: optional,
  sex: z.enum(["female", "male", "unknown"]).default("unknown"),
  preferred_channel: z.enum(["whatsapp", "call", "sms", "email", "none"]).default("whatsapp"),
  email: optional,
});

export async function createPatient(_prev: PatientFormState, form: FormData): Promise<PatientFormState> {
  const ctx = await getContext();
  const raw = Object.fromEntries(form.entries());
  if (typeof raw.national_id === "string") raw.national_id = toWesternDigits(raw.national_id).replace(/\s/g, "");
  const parsed = PatientInput.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "national_id") return { error: friendlyError("national_id_check", ctx.locale) };
    return { error: ctx.locale === "ar" ? "راجع الحقول المطلوبة." : "Please check the required fields." };
  }
  if (!ctx.branchId) return { error: friendlyError("permission denied", ctx.locale) };

  if (form.get("confirm_new") !== "1") {
    const { data: dups } = await ctx.supabase.rpc("find_patient_duplicates", {
      p_phone: parsed.data.phone_raw,
      p_national_id: parsed.data.national_id ?? null,
      p_name: `${parsed.data.first_name_ar} ${parsed.data.last_name_ar}`,
      p_dob: parsed.data.date_of_birth ?? null,
    });
    if (dups && dups.length > 0) return { duplicates: dups };
  }

  const { data, error } = await ctx.supabase
    .from("patients")
    .insert({ ...parsed.data, branch_id: ctx.branchId })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error.message, ctx.locale) };
  revalidatePath("/patients");
  redirect(`/patients/${data.id}`);
}
