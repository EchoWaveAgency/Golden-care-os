import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";

export const metadata = { title: "Marketing funnel" };
export const dynamic = "force-dynamic";

type FunnelRow = { source: string; campaign: string; leads: number; contacted: number; booked: number; arrived: number; revenue: number };
type AbRow = { variant: string; views: number; leads: number; conversion: number | null };
type Landing = { id: string; slug: string; campaign_name: string; variants: unknown[] | null };

const pct = (a: number, b: number) => (b ? `${Math.round((1000 * a) / b) / 10}%` : "—");
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function FunnelPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const ctx = await requireAny("marketing.read", "lead.read", "reports.finance");
  const ar = ctx.locale === "ar";
  const to = isDate(searchParams.to) ? searchParams.to! : clinicToday();
  const from = isDate(searchParams.from) ? searchParams.from! : `${to.slice(0, 8)}01`;

  const [{ data: funnel, error }, { data: pages }] = await Promise.all([
    ctx.supabase.rpc("marketing_funnel", { p_from: from, p_to: to }),
    ctx.supabase.from("landing_pages").select("id, slug, campaign_name, variants").order("campaign_name"),
  ]);
  const rows = (funnel ?? []) as FunnelRow[];
  const withAb = ((pages ?? []) as Landing[]).filter((p) => Array.isArray(p.variants) && p.variants.length > 0);
  const reports = await Promise.all(withAb.map(async (p) => ({ page: p, rows: ((await ctx.supabase.rpc("landing_ab_report", { p_landing: p.id })).data ?? []) as AbRow[] })));
  const sum = (k: keyof FunnelRow) => rows.reduce((s, r) => s + Number(r[k]), 0);

  return (
    <>
      <PageHeader title={ar ? "قمع التسويق" : "Marketing funnel"}
        subtitle={ar ? "من الاستفسار إلى الحجز إلى الحضور والإيراد، حسب المصدر والحملة. وتجارب صفحات الهبوط (أ/ب)." : "From inquiry to booking to visit and revenue, by source and campaign — plus landing page A/B tests."}
        actions={<Link href="/os/leads" className="btn-ghost">{ar ? "الاستفسارات" : "Inquiries"}</Link>} />
      <form className="card mb-5 flex flex-wrap items-end gap-3 p-4 text-sm" data-funnel-range>
        <label><span className="label">{ar ? "من" : "From"}</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label><span className="label">{ar ? "إلى" : "To"}</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn-primary">{ar ? "عرض" : "Show"}</button>
      </form>
      {error ? <div className="card p-5 text-sm text-red-700">{error.message}</div> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-funnel-totals>
            <Stat label={ar ? "استفسارات" : "Inquiries"} value={sum("leads")} />
            <Stat label={ar ? "تم التواصل" : "Contacted"} value={sum("contacted")} />
            <Stat label={ar ? "حجزوا" : "Booked"} value={sum("booked")} tone="teal" />
            <Stat label={ar ? "حضروا" : "Came"} value={sum("arrived")} tone="gold" />
            <Stat label={ar ? "الإيراد" : "Revenue"} value={money(sum("revenue"), ctx.locale)} tone="navy" />
          </div>
          <div className="card mb-6 overflow-x-auto" data-funnel>
            {rows.length === 0 ? <Empty text={ar ? "لا توجد استفسارات في هذه الفترة." : "No inquiries in this period."} /> : (
              <table className="w-full min-w-[800px] text-sm">
                <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
                  <th className="th">{ar ? "المصدر" : "Source"}</th><th className="th">{ar ? "الحملة" : "Campaign"}</th>
                  <th className="th">{ar ? "استفسارات" : "Inquiries"}</th><th className="th">{ar ? "تواصل" : "Contacted"}</th>
                  <th className="th">{ar ? "حجز" : "Booked"}</th><th className="th">{ar ? "حضور" : "Came"}</th>
                  <th className="th">{ar ? "نسبة التحويل" : "Conversion"}</th><th className="th">{ar ? "الإيراد" : "Revenue"}</th>
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.source + r.campaign} className="border-b border-ivory-100">
                    <td className="td">{r.source}</td><td className="td">{r.campaign}</td>
                    <td className="td num">{r.leads}</td><td className="td num">{r.contacted}</td>
                    <td className="td num">{r.booked}</td><td className="td num">{r.arrived}</td>
                    <td className="td num">{pct(Number(r.arrived), Number(r.leads))}</td><td className="td num">{money(r.revenue, ctx.locale)}</td>
                  </tr>))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      <h2 className="mb-3 font-semibold text-navy-700">{ar ? "تجارب صفحات الهبوط (أ/ب)" : "Landing page A/B tests"}</h2>
      <p className="mb-3 text-sm text-ink-500">{ar ? "كل زائر يرى نفس النسخة في كل زيارة. النتائج تحتاج عددًا كافيًا من الزيارات قبل الحكم على الفائز." : "Each visitor keeps seeing the same version. Wait for enough visits before calling a winner."}</p>
      {reports.length === 0 ? <div className="card"><Empty text={ar ? "لا توجد صفحات هبوط بنسخ بديلة. أضف نسخة (ب) من محتوى الموقع." : "No landing pages with variants. Add a version B in Website content."} /></div> : (
        <div className="grid gap-4 md:grid-cols-2" data-ab-reports>
          {reports.map(({ page, rows: ab }) => (
            <div key={page.id} className="card p-4 text-sm" data-ab={page.slug}>
              <div className="mb-2 font-medium">{page.campaign_name} <span className="text-ink-400" dir="ltr">/lp/{page.slug}</span></div>
              {ab.length === 0 ? <p className="text-ink-500">{ar ? "لا زيارات بعد." : "No visits yet."}</p> : (
                <table className="w-full"><thead><tr>
                  <th className="th">{ar ? "النسخة" : "Version"}</th><th className="th">{ar ? "زيارات" : "Views"}</th>
                  <th className="th">{ar ? "استفسارات" : "Inquiries"}</th><th className="th">{ar ? "التحويل" : "Conversion"}</th>
                </tr></thead>
                  <tbody>{ab.map((v) => (
                    <tr key={v.variant}><td className="td">{v.variant.toUpperCase()}</td><td className="td num">{v.views}</td><td className="td num">{v.leads}</td>
                      <td className="td num">{v.conversion == null ? "—" : `${v.conversion}%`}</td></tr>))}
                  </tbody></table>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
