import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { monthRange, type ProfitRow } from "@/lib/reports";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";

export const metadata = { title: "Profitability" };
export const dynamic = "force-dynamic";
const isDate = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

export default async function ProfitabilityPage({ searchParams }: { searchParams: { from?: string; to?: string; by?: string } }) {
  const ctx = await requireAny("reports.finance");
  const ar = ctx.locale === "ar";
  const def = monthRange();
  const from = isDate(searchParams.from) ? searchParams.from! : def.from;
  const to = isDate(searchParams.to) ? searchParams.to! : def.to;
  const by = searchParams.by === "doctor" ? "doctor" : searchParams.by === "service" ? "service" : "both";
  const { data } = await ctx.supabase.rpc("report_profitability", { p_from: from, p_to: to, p_branch: null });
  const raw = (data ?? []) as ProfitRow[];
  const key = (r: ProfitRow) => (by === "doctor" ? r.doctor_id ?? "-" : by === "service" ? r.service_id : `${r.service_id}|${r.doctor_id}`);
  const grouped = new Map<string, ProfitRow>();
  for (const r of raw) {
    const k = key(r);
    const g = grouped.get(k);
    if (!g) grouped.set(k, { ...r, ...(by === "doctor" ? { service_ar: "", service_en: "", service_code: "" } : {}), ...(by === "service" ? { doctor_ar: null, doctor_en: null } : {}) });
    else for (const f of ["units", "gross", "discounts", "refunds", "net_revenue", "doctor_share", "consumables", "lab_costs", "margin"] as const) g[f] = Number(g[f]) + Number(r[f]);
  }
  const rows = Array.from(grouped.values()).sort((a, b) => Number(b.margin) - Number(a.margin));
  const sum = (f: keyof ProfitRow) => raw.reduce((a, r) => a + Number(r[f]), 0);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(Number(r.margin))));
  const pct = (r: ProfitRow) => (Number(r.net_revenue) ? `${((Number(r.margin) / Number(r.net_revenue)) * 100).toFixed(1)}%` : "—");
  const qs = (o: Record<string, string>) => new URLSearchParams({ from, to, by, ...o }).toString();

  return (
    <>
      <PageHeader title={ctx.t("nav.profitability")} subtitle={ar ? "على أساس الفواتير الصادرة: صافي الإيراد بعد الخصومات والمرتجعات، ناقص نصيب الطبيب (تقديري من العقود)، ناقص تكلفة المستهلكات المصروفة على مواعيد الفواتير، ناقص فواتير معامل الأسنان." : "Invoiced basis: net revenue after discounts and refunds, minus doctor share (estimated from contracts), minus consumables issued to the invoices' appointments, minus dental lab bills."}
        actions={<a href={`/os/reports/profitability/export?${qs({ lang: ctx.locale })}`} className="btn-ghost">{ar ? "تصدير Excel (CSV)" : "Export Excel (CSV)"}</a>} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="from">{ar ? "من" : "From"}</label><input id="from" name="from" type="date" defaultValue={from} className="input" /></div>
        <div><label className="label" htmlFor="to">{ar ? "إلى" : "To"}</label><input id="to" name="to" type="date" defaultValue={to} className="input" /></div>
        <div><label className="label" htmlFor="by">{ar ? "التجميع" : "Group by"}</label>
          <select id="by" name="by" defaultValue={by} className="input"><option value="both">{ar ? "الخدمة والطبيب" : "Service & doctor"}</option><option value="service">{ar ? "الخدمة" : "Service"}</option><option value="doctor">{ar ? "الطبيب" : "Doctor"}</option></select></div>
        <button className="btn-primary">{ar ? "عرض" : "Show"}</button>
      </form>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "صافي الإيراد" : "Net revenue"} value={money(sum("net_revenue"), ctx.locale)} />
        <Stat label={ar ? "نصيب الأطباء (تقديري)" : "Doctor share (est.)"} value={money(sum("doctor_share"), ctx.locale)} tone="gold" />
        <Stat label={ar ? "تكلفة المستهلكات" : "Consumables"} value={money(sum("consumables"), ctx.locale)} tone="gold" />
        <Stat label={ar ? "الهامش" : "Margin"} value={money(sum("margin"), ctx.locale)} tone={sum("margin") < 0 ? "danger" : "teal"} />
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>{by !== "doctor" && <th className="th">{ar ? "الخدمة" : "Service"}</th>}{by !== "service" && <th className="th">{ar ? "الطبيب" : "Doctor"}</th>}
                <th className="th">{ar ? "العدد" : "Units"}</th><th className="th">{ar ? "صافي الإيراد" : "Net revenue"}</th><th className="th">{ar ? "المرتجعات" : "Refunds"}</th>
                <th className="th">{ar ? "نصيب الطبيب" : "Doctor share"}</th><th className="th">{ar ? "المستهلكات" : "Consumables"}</th><th className="th">{ar ? "المعمل" : "Lab"}</th><th className="th">{ar ? "الهامش" : "Margin"}</th><th className="th w-40" /></tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((r) => (
                <tr key={key(r)}>
                  {by !== "doctor" && <td className="td">{ar ? r.service_ar : r.service_en} <span className="num text-xs text-ink-300">{r.service_code}</span></td>}
                  {by !== "service" && <td className="td">{(ar ? r.doctor_ar : r.doctor_en) ?? (ar ? "بدون طبيب" : "No doctor")}</td>}
                  <td className="td num">{Number(r.units)}</td>
                  <td className="td num">{money(r.net_revenue, ctx.locale)}</td>
                  <td className="td num text-ink-500">{money(r.refunds, ctx.locale)}</td>
                  <td className="td num text-ink-500">{money(r.doctor_share, ctx.locale)}</td>
                  <td className="td num text-ink-500">{money(r.consumables, ctx.locale)}</td>
                  <td className="td num text-ink-500">{money(r.lab_costs ?? 0, ctx.locale)}</td>
                  <td className={`td num font-medium ${Number(r.margin) < 0 ? "text-danger" : ""}`}>{money(r.margin, ctx.locale)} <span className="text-xs text-ink-300">{pct(r)}</span></td>
                  <td className="td"><div className="h-2 rounded-full bg-ivory-200" aria-hidden><div className={`h-2 rounded-full ${Number(r.margin) < 0 ? "bg-danger" : "bg-teal-700"}`} style={{ width: `${(Math.abs(Number(r.margin)) / maxAbs) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-300">{ar ? "نصيب الطبيب هنا تقديري محسوب من العقود؛ الأرقام النهائية في كشوف المستحقات المعتمدة." : "Doctor share is estimated from contracts; final figures are in the approved settlement statements."} <Link href="/os/settlements" className="text-teal-700 hover:underline">{ctx.t("nav.settlements")}</Link></p>
    </>
  );
}
