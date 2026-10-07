"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { adminClient } from "@/lib/server/admin";
import { putFile, sha256, sniff } from "@/lib/files/store";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Audited service-role path (file store): the user's own session reserves the record (permission checked in
// begin_patient_file); the server then writes the bytes to that exact path and confirms them.
export async function uploadPatientFile(form: FormData) {
  const ctx = await getContext();
  const patient = s(form, "patient_id");
  const back = `/os/patients/${patient}`;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) go(back, { message: "choose a file" }, ctx.locale);
  const buf = Buffer.from(await (file as File).arrayBuffer());
  const type = sniff(buf);
  if (!type) go(back, { message: "only PDF and photos (JPG, PNG, WEBP, HEIC) can be uploaded" }, ctx.locale);
  const { data, error } = await ctx.supabase.rpc("begin_patient_file", { p: {
    patient_id: patient, kind: s(form, "kind"), title: s(form, "title") || (file as File).name, content_type: type, size_bytes: buf.length,
    taken_on: s(form, "taken_on"), appointment_id: s(form, "appointment_id"), body_area: s(form, "body_area"), photo_stage: s(form, "photo_stage"),
  } });
  if (error) go(back, error, ctx.locale);
  const r = data as { id: string; storage_path: string };
  try {
    await putFile(r.storage_path, buf, type!);
  } catch {
    go(back, { message: "the file could not be stored; try again" }, ctx.locale);
  }
  const { error: e2 } = await adminClient().rpc("svc_patient_file_stored", { p_id: r.id, p_sha256: sha256(buf), p_size: buf.length });
  go(back, e2, ctx.locale, "file_uploaded");
}

async function step(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc(fn, { p_id: s(form, "file_id"), ...args });
  go(s(form, "back") || `/os/patients/${s(form, "patient_id")}`, error, ctx.locale, ok);
}
export async function reviewPatientFile(form: FormData) { await step(form, "review_patient_file", { p_abnormal: form.get("abnormal") === "on", p_note: s(form, "note") || null }, "file_reviewed"); }
export async function releasePatientFile(form: FormData) { await step(form, "release_patient_file", { p_note: s(form, "note") || null }, "file_released"); }
export async function voidPatientFile(form: FormData) { await step(form, "void_patient_file", { p_reason: s(form, "reason") }, "file_voided"); }
