import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAny } from "@/lib/session";
import { storesFor } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { StockLines } from "@/components/StockLines";
import { receiveGoods } from "@/app/actions/inventory";
import { StoreTabs } from "../StoreTabs";

export const dynamic = "force-dynamic";

export default async function ReceivePage({ searchParams }: { searchParams: { loc?: string; error?: string } }) {
  const ctx = await requireAny("inventory.receive");
  const ar = ctx.locale === "ar";
  const { list, current } = await storesFor(ctx, searchParams.loc);
  const [{ data: items }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("inv_items").select("id, code, name_ar, name_en, unit, category, is_controlled").eq("is_active", true).order("code"),
    ctx.supabase.from("suppliers").select("id, name_ar, name_en").eq("is_active", true).order("name_ar"),
  ]);
  return (
    <>
      <PageHeader title={ar ? "استلام بضاعة" : "Receive goods"} subtitle={ar ? "يُسجّل الصنف بتشغيلته وتاريخ صلاحيته وتكلفته، ويُرحّل قيد: مدين المخزون / دائن الموردين." : "Each line is stored as a lot with expiry and cost; posts Dr Inventory / Cr Suppliers payable."}
        actions={<Link href={`/os/inventory?loc=${current?.id ?? ""}`} className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error} />
      <StoreTabs stores={list} current={current} base="/os/inventory/receive" ar={ar} />
      {!current ? <p className="text-sm text-ink-500">{ar ? "أضف مخزنًا أولًا من شاشة الأصناف." : "Add a store first in the catalog."}</p> : (
        <form key={searchParams.error ?? "new"} action={receiveGoods} className="card space-y-4 p-5">
          <input type="hidden" name="location_id" value={current.id} />
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="supplier_id">{ar ? "المورد" : "Supplier"}</label>
              <select id="supplier_id" name="supplier_id" required className="input">{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{ar ? s.name_ar : s.name_en ?? s.name_ar}</option>)}</select></div>
            <div><label className="label" htmlFor="supplier_invoice_no">{ar ? "رقم فاتورة المورد" : "Supplier invoice no."}</label><input id="supplier_invoice_no" name="supplier_invoice_no" required className="input" dir="ltr" /></div>
          </div>
          <StockLines ar={ar} mode="receive" items={(items ?? []).map((i) => ({ id: i.id, code: i.code, name: ar ? i.name_ar : i.name_en, unit: i.unit, controlled: i.is_controlled,
            needsExpiry: ["drug", "cosmetic", "dental_material"].includes(i.category) }))} />
          <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تسجيل الاستلام" : "Post receipt"}</SubmitButton>
        </form>
      )}
    </>
  );
}
