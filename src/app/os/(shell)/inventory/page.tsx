import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { storesFor, CATEGORY } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { Empty } from "@/components/Empty";
import { StoreTabs } from "./StoreTabs";

export const metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

type Pos = { item_id: string; code: string; name_ar: string; name_en: string; unit: string; category: string; is_controlled: boolean; reorder_level: number;
  on_hand: number; usable: number; value: number; expired_qty: number; next_expiry: string | null; below_reorder: boolean };
type Move = { id: string; kind: string; qty: number; value: number; created_at: string; item: { code: string; name_ar: string; name_en: string } | null };

export default async function InventoryPage({ searchParams }: { searchParams: { loc?: string; ok?: string; error?: string } }) {
  const ctx = await requireAny("inventory.read", "inventory.issue", "inventory.receive", "inventory.count", "inventory.approve", "inventory.manage");
  const ar = ctx.locale === "ar";
  const { list, current } = await storesFor(ctx, searchParams.loc);
  const canRead = ctx.can("inventory.read");
  const [{ data: pos }, { data: moves }] = current && canRead ? await Promise.all([
    ctx.supabase.rpc("inventory_position", { p_location: current.id }),
    ctx.supabase.from("stock_moves").select("id, kind, qty, value, created_at, item:inv_items(code, name_ar, name_en)").eq("location_id", current.id)
      .order("created_at", { ascending: false }).limit(15).returns<Move[]>(),
  ]) : [{ data: [] }, { data: [] }];
  const rows = (pos ?? []) as Pos[];
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const nearExpiry = rows.filter((r) => r.next_expiry && r.next_expiry <= soon);
  const expired = rows.filter((r) => Number(r.expired_qty) > 0);
  const low = rows.filter((r) => r.below_reorder);
  const value = rows.reduce((a, r) => a + Number(r.value), 0);
  const [okKind, okRef] = (searchParams.ok ?? "").split(":");
  const ok = okKind === "received" ? (ar ? `تم الاستلام ${okRef} وتسجيل القيد.` : `Received ${okRef} and posted.`) : undefined;
  const base = `?loc=${current?.id ?? ""}`;
  const kind = (k: string) => ({ receipt: ar ? "استلام" : "Receipt", issue: ar ? "صرف" : "Issue", count_adjust: ar ? "تسوية جرد" : "Count adjustment" }[k] ?? k);

  return (
    <>
      <PageHeader title={ctx.t("nav.inventory")} subtitle={current ? (ar ? current.name_ar : current.name_en) : (ar ? "لا يوجد مخزن معرّف بعد" : "No store defined yet")}
        actions={<>
          {ctx.can("inventory.issue") && <Link href={`/os/inventory/issue${base}`} className="btn-primary">{ar ? "صرف مستهلكات" : "Issue"}</Link>}
          {ctx.can("inventory.receive") && <Link href={`/os/inventory/receive${base}`} className="btn-gold">{ar ? "استلام بضاعة" : "Receive"}</Link>}
          {(ctx.can("inventory.count") || ctx.can("inventory.approve")) && <Link href={`/os/inventory/counts${base}`} className="btn-ghost">{ar ? "الجرد" : "Counts"}</Link>}
          {ctx.can("inventory.manage") && <Link href="/os/inventory/catalog" className="btn-ghost">{ar ? "الأصناف والموردون" : "Catalog"}</Link>}
        </>} />
      <Banner error={searchParams.error} success={ok} />
      <StoreTabs stores={list} current={current} base="/os/inventory" ar={ar} />
      {!canRead ? <div className="card"><Empty text={ar ? "استخدم «صرف مستهلكات» لتسجيل ما استُخدم في الجلسة." : "Use Issue to record what was used in a session."} /></div> : (<>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={ar ? "قيمة المخزون" : "Stock value"} value={money(value, ctx.locale)} />
          <Stat label={ar ? "تحت حد الطلب" : "Below reorder level"} value={low.length} tone={low.length ? "gold" : "navy"} />
          <Stat label={ar ? "تنتهي خلال 60 يومًا" : "Expiring within 60 days"} value={nearExpiry.length} tone={nearExpiry.length ? "gold" : "navy"} />
          <Stat label={ar ? "أصناف بها كميات منتهية" : "Items with expired stock"} value={expired.length} tone={expired.length ? "danger" : "navy"} />
        </div>
        {expired.length > 0 && <p className="mb-4 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger">{ar ? "توجد كميات منتهية الصلاحية على الرف. النظام يمنع صرفها؛ اعزلها وسجّلها في الجرد القادم بكمية صفر." : "Expired stock is on the shelf. It cannot be issued; quarantine it and record it as zero in the next count."}</p>}
        <div className="card overflow-x-auto">
          {rows.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-ivory-200 bg-ivory-50">
                <tr><th className="th">{ar ? "الصنف" : "Item"}</th><th className="th">{ar ? "الفئة" : "Category"}</th><th className="th">{ar ? "المتاح للصرف" : "Usable"}</th>
                  <th className="th">{ar ? "منتهي" : "Expired"}</th><th className="th">{ar ? "أقرب انتهاء" : "Next expiry"}</th><th className="th">{ar ? "القيمة" : "Value"}</th></tr>
              </thead>
              <tbody className="divide-y divide-ivory-200">
                {rows.map((r) => (
                  <tr key={r.item_id} className={r.below_reorder ? "bg-gold-50/60" : ""}>
                    <td className="td"><span className="num text-xs text-ink-300">{r.code}</span> {ar ? r.name_ar : r.name_en}{r.is_controlled ? " ⚠" : ""}
                      {r.below_reorder && <span className="ms-2 rounded-full bg-gold-100 px-2 py-0.5 text-xs text-gold-800">{ar ? "اطلب الآن" : "Reorder"}</span>}</td>
                    <td className="td text-ink-500">{ar ? CATEGORY[r.category]?.[0] : CATEGORY[r.category]?.[1]}</td>
                    <td className="td num">{Number(r.usable)} <span className="text-xs text-ink-300">{r.unit}</span></td>
                    <td className={`td num ${Number(r.expired_qty) > 0 ? "text-danger" : "text-ink-300"}`}>{Number(r.expired_qty) || "—"}</td>
                    <td className={`td num ${r.next_expiry && r.next_expiry <= soon ? "text-gold-800" : ""}`}>{r.next_expiry ?? "—"}</td>
                    <td className="td num">{money(r.value, ctx.locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <section className="mt-6">
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "آخر الحركات" : "Latest movements"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">
            {(moves ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
            {(moves ?? []).map((m) => (
              <li key={m.id} className="flex justify-between px-5 py-2">
                <span>{kind(m.kind)} · {ar ? m.item?.name_ar : m.item?.name_en} <span className="num text-xs text-ink-300">{m.item?.code}</span></span>
                <span className={`num ${m.qty < 0 ? "text-danger" : "text-ok"}`}>{m.qty > 0 ? "+" : ""}{Number(m.qty)} · {money(m.value, ctx.locale)} <span className="text-xs text-ink-300">{dateTime(m.created_at, ctx.locale)}</span></span>
              </li>
            ))}
          </ul>
        </section>
      </>)}
    </>
  );
}
