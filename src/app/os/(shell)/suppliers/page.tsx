import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";

export const metadata = { title: "Suppliers" };
export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const ctx = await requireAny("supplier.pay.request", "supplier.pay.approve");
  const ar = ctx.locale === "ar";
  const [{ data: sups }, { data: grs }, { data: pend }] = await Promise.all([
    ctx.supabase.from("suppliers").select("id, name_ar, name_en, phone").order("name_ar"),
    ctx.supabase.from("goods_receipts").select("supplier_id, total, amount_paid"),
    ctx.supabase.from("supplier_payments").select("supplier_id, amount").eq("status", "requested"),
  ]);
  const owed = new Map<string, number>();
  for (const g of grs ?? []) owed.set(g.supplier_id, (owed.get(g.supplier_id) ?? 0) + Number(g.total) - Number(g.amount_paid));
  const pending = new Map<string, number>();
  for (const p of pend ?? []) pending.set(p.supplier_id, (pending.get(p.supplier_id) ?? 0) + Number(p.amount));
  const totalOwed = Array.from(owed.values()).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title={ctx.t("nav.suppliers")} subtitle={ar ? "الدفعة يطلبها محاسب ويصرفها مسؤول آخر؛ القيد يُرحّل عند الصرف." : "Payments are requested by one person and released by another; posted on release."} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={ar ? "إجمالي المستحق للموردين" : "Owed to suppliers"} value={money(totalOwed, ctx.locale)} tone="gold" />
        <Stat label={ar ? "دفعات بانتظار الصرف" : "Payments awaiting release"} value={(pend ?? []).length} tone={(pend ?? []).length ? "danger" : "navy"} />
      </div>
      <div className="card">
        {(sups ?? []).length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200 text-sm">
            {(sups ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between px-5 py-3">
                <Link href={`/os/suppliers/${s.id}`} className="font-medium text-navy-700 hover:underline">{ar ? s.name_ar : s.name_en ?? s.name_ar}</Link>
                <span className="flex items-center gap-3">
                  {pending.get(s.id) ? <span className="rounded-full bg-warn-50 px-2 py-0.5 text-xs text-warn">{ar ? "بانتظار الصرف" : "Pending"} {money(pending.get(s.id)!, ctx.locale)}</span> : null}
                  <span className="num font-medium">{money(owed.get(s.id) ?? 0, ctx.locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
