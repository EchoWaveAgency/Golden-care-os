"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const s = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

export async function savePackageTemplate(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_package_template", {
    p: { id: s(form, "id"), code: s(form, "code"), name_ar: s(form, "name_ar"), name_en: s(form, "name_en"), service_id: s(form, "service_id"),
      sessions: Number(s(form, "sessions")), price: Number(s(form, "price")), validity_days: Number(s(form, "validity_days")),
      branch_id: s(form, "branch_id"), terms_ar: form.has("terms_ar") ? s(form, "terms_ar") : undefined, is_active: form.has("is_active") ? form.get("is_active") === "on" : undefined },
  });
  go("/os/packages", error, ctx.locale, s(form, "id") ? "updated" : "created");
}

/** Sells the package (creates and issues the invoice) and sends the user to the invoice to collect payment. */
export async function sellPackage(form: FormData) {
  const ctx = await getContext();
  const patient = s(form, "patient_id");
  const { data, error } = await ctx.supabase.rpc("sell_package", {
    p_patient: patient, p_template: s(form, "template_id"), p_branch: ctx.branchId, p_discount: Number(s(form, "discount") || 0),
    p_idempotency_key: s(form, "idempotency_key") || null,
  });
  if (error) go(`/os/patients/${patient}`, error, ctx.locale);
  redirect(`/os/billing/${(data as { invoice_id: string }).invoice_id}?ok=package`);
}

export async function expirePackages() {
  const ctx = await getContext();
  // All branches when the grant is global; otherwise the user's own branch.
  let { data, error } = await ctx.supabase.rpc("expire_packages", { p_branch: null });
  if (error && /all branches/.test(error.message)) ({ data, error } = await ctx.supabase.rpc("expire_packages", { p_branch: ctx.branchId }));
  go("/os/packages", error, ctx.locale, `expired:${Number(data ?? 0)}`);
}
