"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { clinicLocalToIso } from "@/lib/format";
import { benefitsFromText, contentType, faqFromText } from "@/lib/content";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}
const UUID = /^[0-9a-f-]{36}$/i;

export async function saveContent(form: FormData) {
  const ctx = await getContext();
  const type = contentType(String(form.get("type")));
  if (!type) redirect("/os/content");
  const id = String(form.get("id") ?? "");
  const back = id ? `/os/content/${type.key}/${id}` : `/os/content/${type.key}/new`;
  const row: Record<string, unknown> = {};

  for (const f of type.fields) {
    const raw = form.get(f.name);
    const str = typeof raw === "string" ? raw.trim() : "";
    switch (f.type) {
      case "bool": row[f.name] = form.get(f.name) === "on"; break;
      case "number": row[f.name] = str === "" ? null : Number(str); break;
      case "datetime": {
        const m = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
        row[f.name] = m ? clinicLocalToIso(m[1], m[2]) : null; break;
      }
      case "date": row[f.name] = /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null; break;
      case "specialty": case "staff": case "service": case "offer": row[f.name] = UUID.test(str) ? str : null; break;
      case "faq": row[f.name] = faqFromText(String(form.get(`${f.name}_ar`) ?? ""), String(form.get(`${f.name}_en`) ?? "")); break;
      case "lines": row[f.name] = benefitsFromText(String(form.get(`${f.name}_ar`) ?? ""), String(form.get(`${f.name}_en`) ?? "")); break;
      case "slug": row[f.name] = str.toLowerCase(); break;
      default: row[f.name] = str === "" ? null : str;
    }
    if (f.required && (row[f.name] === null || row[f.name] === "")) {
      fail(back, ctx.locale === "ar" ? `الحقل مطلوب: ${f.ar}` : `Required: ${f.en}`);
    }
  }
  if (type.table === "landing_pages" && row.starts_at === null) delete row.starts_at;
  if (type.table === "offers" && !id) row.branch_id = ctx.branchId;

  const q = id
    ? ctx.supabase.from(type.table).update(row).eq("id", id).select("id").single()
    : ctx.supabase.from(type.table).insert(row).select("id").single();
  const { data, error } = await q;
  if (error) fail(back, friendlyError(error.message, ctx.locale));
  revalidatePath("/os/content");
  redirect(`/os/content/${type.key}/${data.id}?saved=1`);
}

export async function transitionContent(form: FormData) {
  const ctx = await getContext();
  const type = contentType(String(form.get("type")));
  if (!type) redirect("/os/content");
  const id = String(form.get("id"));
  const path = `/os/content/${type.key}/${id}`;
  const { error } = await ctx.supabase.rpc("content_transition", {
    p_table: type.table, p_id: id, p_to: String(form.get("to")), p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) fail(path, friendlyError(error.message, ctx.locale));
  revalidatePath(path);
  revalidatePath("/ar", "layout");
  revalidatePath("/en", "layout");
  redirect(path);
}
