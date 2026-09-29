import Link from "next/link";
import { requireAny } from "@/lib/session";
import { storesFor } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { StockLines } from "@/components/StockLines";
import { createPo } from "@/app/actions/purchasing";

export const dynamic = "force-dynamic";

export default async function NewPo({ searchParams }: { searchParams: { error?: string } }) {
  const ctx = await requireAny("purchase.request");
  const ar = ctx.locale === "ar";
  const { list, current } = await storesFor(ctx);
  const [{ data: items }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("inv_items").select("id, code, name_ar, name_en, unit").eq("is_active", true).order("code"),
    ctx.supabase.from("suppliers").select("id, name_ar, name_en").eq("is_active", true).order("name_ar"),
  ]);
  return (
    <>
      <PageHeader title={ar ? "أمر شراء جديد" : "New purchase order"} actions={<Link href="/os/purchasing" className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error} />
      <form action={createPo} className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="location_id">{ar ? "المخزن" : "Store"}</label>
            <select id="location_id" name="location_id" defaultValue={current?.id} className="input">{list.map((l) => <option key={l.id} value={l.id}>{ar ? l.name_ar : l.name_en}</option>)}</select></div>
          <div><label className="label" htmlFor="supplier_id">{ar ? "المورد" : "Supplier"}</label>
            <select id="supplier_id" name="supplier_id" className="input">{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{ar ? s.name_ar : s.name_en ?? s.name_ar}</option>)}</select></div>
          <div><label className="label" htmlFor="expected_on">{ar ? "تاريخ التوريد المتوقع" : "Expected delivery"}</label><input id="expected_on" name="expected_on" type="date" className="input" /></div>
        </div>
        <StockLines ar={ar} mode="order" items={(items ?? []).map((i) => ({ id: i.id, code: i.code, name: ar ? i.name_ar : i.name_en, unit: i.unit }))} />
        <div><label className="label" htmlFor="notes">{ar ? "ملاحظات" : "Notes"}</label><input id="notes" name="notes" className="input" /></div>
        <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "حفظ كمسودة" : "Save draft"}</SubmitButton>
      </form>
    </>
  );
}
