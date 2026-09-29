import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { storesFor } from "@/lib/inventory";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { startCount } from "@/app/actions/inventory";
import { StoreTabs } from "../StoreTabs";

export const dynamic = "force-dynamic";
const ST: Record<string, [string, string, string]> = {
  draft: ["قيد العد", "Counting", "pending_confirmation"], submitted: ["بانتظار الاعتماد", "Awaiting approval", "confirmed"],
  approved: ["معتمد", "Approved", "completed"], cancelled: ["ملغي", "Cancelled", "canceled"],
};

export default async function CountsPage({ searchParams }: { searchParams: { loc?: string; error?: string } }) {
  const ctx = await requireAny("inventory.count", "inventory.approve");
  const ar = ctx.locale === "ar";
  const { list, current } = await storesFor(ctx, searchParams.loc);
  const { data: counts } = current ? await ctx.supabase.from("stock_counts").select("id, ref, status, started_at, net_value").eq("location_id", current.id).order("started_at", { ascending: false }).limit(30) : { data: [] };
  return (
    <>
      <PageHeader title={ar ? "الجرد" : "Stock counts"} subtitle={ar ? "العد يتم بدون إظهار الرصيد الدفتري. الفروق لا تُسجل إلا بعد اعتماد شخص آخر." : "Counts are blind (no system quantity shown). Differences post only after someone else approves."}
        actions={ctx.can("inventory.count") && current ? <form action={startCount}><input type="hidden" name="location_id" value={current.id} /><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "بدء جرد" : "Start count"}</SubmitButton></form> : undefined} />
      <Banner error={searchParams.error} />
      <StoreTabs stores={list} current={current} base="/os/inventory/counts" ar={ar} />
      <div className="card">
        {(counts ?? []).length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200 text-sm">
            {(counts ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3">
                <Link href={`/os/inventory/counts/${c.id}`} className="num font-medium text-navy-700 hover:underline">{c.ref} <span className="text-xs font-normal text-ink-300">{dateTime(c.started_at, ctx.locale)}</span></Link>
                <span className="flex items-center gap-3">{c.net_value != null && <span className={`num ${Number(c.net_value) < 0 ? "text-danger" : ""}`}>{money(c.net_value, ctx.locale)}</span>}
                  <StatusBadge status={ST[c.status]?.[2] ?? "draft"} label={(ar ? ST[c.status]?.[0] : ST[c.status]?.[1]) ?? c.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
