import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { approveCount, cancelCount, submitCount } from "@/app/actions/inventory";

export const dynamic = "force-dynamic";
type Line = { id: string; lot_id: string; system_qty: number | null; counted_qty: number | null;
  lot: { lot_no: string; expiry: string | null; unit_cost: number; item: { code: string; name_ar: string; name_en: string; unit: string } } | null };

export default async function CountPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("inventory.count", "inventory.approve");
  const ar = ctx.locale === "ar";
  const { data: c } = await ctx.supabase.from("stock_counts").select("id, ref, status, counted_by, location_id, net_value").eq("id", params.id).maybeSingle();
  if (!c) notFound();
  const { data: lines } = await ctx.supabase.from("stock_count_lines")
    .select("id, lot_id, system_qty, counted_qty, lot:inv_lots(lot_no, expiry, unit_cost, item:inv_items(code, name_ar, name_en, unit))")
    .eq("count_id", c.id).returns<Line[]>();
  const rows = (lines ?? []).sort((a, b) => (a.lot?.item.code ?? "").localeCompare(b.lot?.item.code ?? ""));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const mine = c.counted_by === ctx.user.id;
  const blind = c.status === "draft";
  const ok = { submitted: ar ? "تم تقديم الجرد للاعتماد." : "Count submitted for approval.", approved: ar ? "تم اعتماد الجرد وتسجيل الفروق." : "Count approved; differences posted.", cancelled: ar ? "تم إلغاء الجرد." : "Count cancelled." }[searchParams.ok ?? ""];

  return (
    <>
      <PageHeader title={`${ar ? "جرد" : "Count"} ${c.ref}`} actions={<Link href={`/os/inventory/counts?loc=${c.location_id}`} className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      <form key={c.status} action={submitCount} className="card overflow-x-auto">
        <input type="hidden" name="count_id" value={c.id} />
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-ivory-200 bg-ivory-50">
            <tr><th className="th">{ar ? "الصنف" : "Item"}</th><th className="th">{ar ? "التشغيلة" : "Lot"}</th><th className="th">{ar ? "الصلاحية" : "Expiry"}</th>
              {!blind && <th className="th">{ar ? "الدفتري" : "System"}</th>}<th className="th">{ar ? "المعدود" : "Counted"}</th>{!blind && <th className="th">{ar ? "الفرق" : "Difference"}</th>}</tr>
          </thead>
          <tbody className="divide-y divide-ivory-200">
            {rows.map((l) => {
              const diff = l.counted_qty != null && l.system_qty != null ? Number(l.counted_qty) - Number(l.system_qty) : null;
              const expired = l.lot?.expiry && l.lot.expiry <= today;
              return (
                <tr key={l.id} className={expired ? "bg-danger-50/50" : ""}>
                  <td className="td"><span className="num text-xs text-ink-300">{l.lot?.item.code}</span> {ar ? l.lot?.item.name_ar : l.lot?.item.name_en}</td>
                  <td className="td num">{l.lot?.lot_no}</td>
                  <td className={`td num ${expired ? "text-danger" : ""}`}>{l.lot?.expiry ?? "—"}{expired ? (ar ? " (منتهي)" : " (expired)") : ""}</td>
                  {!blind && <td className="td num">{Number(l.system_qty)}</td>}
                  <td className="td">{blind && mine
                    ? <input name={`lot_${l.lot_id}`} type="number" min="0" step="0.001" required className="input num w-28 py-1" aria-label={ar ? "الكمية المعدودة" : "Counted quantity"} />
                    : <span className="num">{l.counted_qty ?? "—"}</span>}</td>
                  {!blind && <td className={`td num ${diff && diff < 0 ? "text-danger" : diff ? "text-ok" : ""}`}>{diff ? `${diff > 0 ? "+" : ""}${diff} · ${money(diff * Number(l.lot?.unit_cost ?? 0), ctx.locale)}` : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {blind && mine && <div className="border-t border-ivory-200 p-4"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "تقديم الجرد" : "Submit count"}</SubmitButton></div>}
      </form>
      {c.status === "submitted" && <p className="mt-4 text-sm">{ar ? "صافي الفرق" : "Net difference"}: <span className={`num font-semibold ${Number(c.net_value) < 0 ? "text-danger" : ""}`}>{money(c.net_value ?? 0, ctx.locale)}</span></p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {c.status === "submitted" && ctx.can("inventory.approve") && (mine
          ? <p className="text-sm text-ink-500">{ar ? "قمت بهذا الجرد — يلزم اعتماد مسؤول آخر." : "You counted this — another approver is required."}</p>
          : <form action={approveCount}><input type="hidden" name="count_id" value={c.id} /><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "اعتماد وتسجيل الفروق" : "Approve and post"}</SubmitButton></form>)}
        {(c.status === "draft" || c.status === "submitted") && (
          <form action={cancelCount} className="flex items-center gap-2"><input type="hidden" name="count_id" value={c.id} />
            <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-48" />
            <SubmitButton pendingLabel="…" className="btn-danger">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>
        )}
      </div>
    </>
  );
}
