import Link from "next/link";
import { requireAny } from "@/lib/session";
import { CATEGORY } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { saveItem, saveLocation, saveSupplier, saveTemplate } from "@/app/actions/inventory";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("inventory.manage");
  const ar = ctx.locale === "ar";
  const [{ data: items }, { data: suppliers }, { data: stores }, { data: branches }, { data: services }, { data: tpl }] = await Promise.all([
    ctx.supabase.from("inv_items").select("*").order("code"),
    ctx.supabase.from("suppliers").select("id, name_ar, name_en, phone").order("name_ar"),
    ctx.supabase.from("inv_locations").select("id, code, name_ar, name_en, branch_id").order("code"),
    ctx.supabase.from("branches").select("id, name_ar, name_en").eq("is_active", true),
    ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("is_active", true).order("code"),
    ctx.supabase.from("service_consumables").select("service_id, item_id, qty"),
  ]);
  const svc = new Map((services ?? []).map((s) => [s.id, s]));
  const itm = new Map((items ?? []).map((i) => [i.id, i]));
  return (
    <>
      <PageHeader title={ar ? "الأصناف والمخازن والموردون" : "Items, stores & suppliers"} actions={<Link href="/os/inventory" className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? "تم الحفظ." : "Saved.") : undefined} />
      <section className="card mb-6 p-5">
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "الأصناف" : "Items"}</h2>
        <div className="space-y-2">
          {(items ?? []).map((i) => (
            <form key={`${i.id}-${i.reorder_level}-${i.is_active}`} action={saveItem} className="grid items-center gap-2 rounded-lg bg-ivory-50 p-2 text-sm sm:grid-cols-12">
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="code" value={i.code} />
              <span className="num sm:col-span-2">{i.code}</span>
              <input name="name_ar" defaultValue={i.name_ar} className="input py-1 sm:col-span-3" aria-label="name_ar" />
              <input name="name_en" defaultValue={i.name_en} className="input py-1 sm:col-span-2" aria-label="name_en" dir="ltr" />
              <input type="hidden" name="unit" value={i.unit} /><input type="hidden" name="category" value={i.category} />
              <input type="hidden" name="is_controlled" value={i.is_controlled ? "on" : ""} />
              <label className="sm:col-span-2 text-xs text-ink-500">{ar ? "حد الطلب" : "Reorder at"} <input name="reorder_level" type="number" min="0" step="0.001" defaultValue={Number(i.reorder_level)} className="input num w-20 py-1" /></label>
              <select name="is_active" defaultValue={i.is_active ? "on" : "off"} className="input py-1 sm:col-span-2"><option value="on">{ar ? "نشط" : "Active"}</option><option value="off">{ar ? "موقوف" : "Inactive"}</option></select>
              <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{ctx.t("common.save")}</SubmitButton>
            </form>
          ))}
        </div>
        <form action={saveItem} className="mt-4 grid gap-2 border-t border-ivory-200 pt-4 sm:grid-cols-6">
          <input name="code" required placeholder={ar ? "الكود (مثل GEL-US)" : "Code (e.g. GEL-US)"} className="input" dir="ltr" />
          <input name="name_ar" required placeholder={ar ? "الاسم بالعربية" : "Arabic name"} className="input" />
          <input name="name_en" required placeholder={ar ? "الاسم بالإنجليزية" : "English name"} className="input" dir="ltr" />
          <input name="unit" placeholder={ar ? "الوحدة (علبة، أمبول…)" : "Unit"} className="input" />
          <select name="category" className="input">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select>
          <input name="reorder_level" type="number" min="0" step="0.001" placeholder={ar ? "حد الطلب" : "Reorder level"} className="input num" />
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="is_controlled" /> {ar ? "صنف خاضع للرقابة (يتطلب صلاحية خاصة للصرف)" : "Controlled item (special authorization to issue)"}</label>
          <div className="sm:col-span-2"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إضافة صنف" : "Add item"}</SubmitButton></div>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "المخازن" : "Stores"}</h2>
          <ul className="mb-3 space-y-1 text-sm">{(stores ?? []).map((s) => <li key={s.id}><span className="num text-xs text-ink-300">{s.code}</span> {ar ? s.name_ar : s.name_en}</li>)}</ul>
          <form action={saveLocation} className="grid gap-2 sm:grid-cols-2">
            <select name="branch_id" className="input">{(branches ?? []).map((b) => <option key={b.id} value={b.id}>{ar ? b.name_ar : b.name_en}</option>)}</select>
            <input name="code" required placeholder={ar ? "الكود" : "Code"} className="input" dir="ltr" />
            <input name="name_ar" required placeholder={ar ? "الاسم بالعربية" : "Arabic name"} className="input" />
            <input name="name_en" required placeholder={ar ? "الاسم بالإنجليزية" : "English name"} className="input" dir="ltr" />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إضافة مخزن" : "Add store"}</SubmitButton>
          </form>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "الموردون" : "Suppliers"}</h2>
          <ul className="mb-3 space-y-1 text-sm">{(suppliers ?? []).map((s) => <li key={s.id}>{ar ? s.name_ar : s.name_en ?? s.name_ar} <span className="num text-xs text-ink-300">{s.phone}</span></li>)}</ul>
          <form action={saveSupplier} className="grid gap-2 sm:grid-cols-2">
            <input name="name_ar" required placeholder={ar ? "اسم المورد" : "Supplier name (Arabic)"} className="input" />
            <input name="name_en" placeholder={ar ? "الاسم بالإنجليزية" : "English name"} className="input" dir="ltr" />
            <input name="tax_id" placeholder={ar ? "الرقم الضريبي" : "Tax ID"} className="input" dir="ltr" />
            <input name="phone" placeholder={ar ? "الهاتف" : "Phone"} className="input" dir="ltr" />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إضافة مورد" : "Add supplier"}</SubmitButton>
          </form>
        </section>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="mb-1 font-medium text-navy-700">{ar ? "مستهلكات كل خدمة (قالب)" : "Consumables per service (template)"}</h2>
        <p className="mb-3 text-xs text-ink-500">{ar ? "يُستخدم لملء شاشة الصرف تلقائيًا عند اختيار موعد؛ الممرضة تراجع الكميات قبل التسجيل. كمية 0 تحذف السطر." : "Prefills the issue screen for an appointment; the nurse confirms before posting. Quantity 0 removes the line."}</p>
        <ul className="mb-3 space-y-1 text-sm">{(tpl ?? []).map((t) => <li key={`${t.service_id}-${t.item_id}`}>{ar ? svc.get(t.service_id)?.name_ar : svc.get(t.service_id)?.name_en} ← <span className="num">{Number(t.qty)}</span> × {ar ? itm.get(t.item_id)?.name_ar : itm.get(t.item_id)?.name_en}</li>)}</ul>
        <form action={saveTemplate} className="grid gap-2 sm:grid-cols-4">
          <select name="service_id" className="input" aria-label={ar ? "الخدمة" : "Service"}>{(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} — {ar ? s.name_ar : s.name_en}</option>)}</select>
          <select name="item_id" className="input" aria-label={ar ? "الصنف" : "Item"}>{(items ?? []).filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.code} — {ar ? i.name_ar : i.name_en}</option>)}</select>
          <input name="qty" type="number" min="0" step="0.001" required placeholder={ar ? "الكمية لكل خدمة" : "Qty per service"} className="input num" />
          <SubmitButton pendingLabel="…" className="btn-ghost">{ctx.t("common.save")}</SubmitButton>
        </form>
      </section>
    </>
  );
}
