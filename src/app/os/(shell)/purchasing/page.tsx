import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { StatusBadge } from "@/components/StatusBadge";
import { PO_STATUS } from "@/lib/purchasing";

export const metadata = { title: "Purchasing" };
export const dynamic = "force-dynamic";


export default async function PurchasingPage({ searchParams }: { searchParams: { view?: string } }) {
  const ctx = await requireAny("purchase.read", "purchase.request", "purchase.approve");
  const ar = ctx.locale === "ar";
  const view = searchParams.view === "all" ? "all" : "open";
  let q = ctx.supabase.from("purchase_orders").select("id, ref, status, total, created_at, expected_on, supplier:suppliers(name_ar, name_en)").order("created_at", { ascending: false }).limit(100);
  if (view === "open") q = q.in("status", ["draft", "submitted", "approved", "partially_received"]);
  const { data } = await q.returns<{ id: string; ref: string; status: string; total: number; created_at: string; expected_on: string | null; supplier: { name_ar: string; name_en: string | null } | null }[]>();
  return (
    <>
      <PageHeader title={ctx.t("nav.purchasing")} subtitle={ar ? "أمر الشراء يعتمده شخص غير الذي أنشأه، والاستلام عليه يلتزم بأصنافه وكمياته وأسعاره." : "Orders are approved by someone other than their author; receipts must match their items, quantities and prices."}
        actions={ctx.can("purchase.request") ? <Link href="/os/purchasing/new" className="btn-primary">{ar ? "أمر شراء جديد" : "New purchase order"}</Link> : undefined} />
      <nav className="mb-4 flex gap-2">
        {([["open", "المفتوحة", "Open"], ["all", "الكل", "All"]] as const).map(([k, a, e]) => <Link key={k} href={`/os/purchasing?view=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>)}
      </nav>
      <div className="card">
        {(data ?? []).length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200 text-sm">
            {(data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <Link href={`/os/purchasing/${p.id}`} className="hover:underline"><span className="num font-medium text-navy-700">{p.ref}</span> · {ar ? p.supplier?.name_ar : p.supplier?.name_en ?? p.supplier?.name_ar}
                  <span className="block text-xs text-ink-300">{dateTime(p.created_at, ctx.locale)}{p.expected_on ? ` · ${ar ? "متوقع" : "expected"} ${p.expected_on}` : ""}</span></Link>
                <span className="flex items-center gap-3"><span className="num font-medium">{money(p.total, ctx.locale)}</span>
                  <StatusBadge status={PO_STATUS[p.status]?.[2] ?? "draft"} label={(ar ? PO_STATUS[p.status]?.[0] : PO_STATUS[p.status]?.[1]) ?? p.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
