import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { StatusBadge } from "@/components/StatusBadge";
import { SETTLEMENT_STATUS, monthLabel } from "@/components/SettlementStatement";

export const metadata = { title: "My statements" };
export const dynamic = "force-dynamic";

export default async function MySettlements() {
  const ctx = await requireAny("clinical.write.own");
  const ar = ctx.locale === "ar";
  const { data: runs } = await ctx.supabase.from("settlement_runs").select("id, ref, period, status, amount")
    .eq("doctor_id", ctx.staff?.id ?? "00000000-0000-0000-0000-000000000000").order("period", { ascending: false });
  const { data: contract } = await ctx.supabase.from("doctor_contracts").select("valid, default_percent, rates:doctor_contract_rates(percent, fixed_amount, service:services(name_ar, name_en))")
    .eq("doctor_id", ctx.staff?.id ?? "00000000-0000-0000-0000-000000000000").order("valid", { ascending: false }).limit(1).maybeSingle();
  const c = contract as unknown as { default_percent: number; rates: { percent: number | null; fixed_amount: number | null; service: { name_ar: string; name_en: string } }[] } | null;
  return (
    <>
      <PageHeader title={ctx.t("nav.mySettlements")} subtitle={ar ? "كشوفك الشهرية المعتمدة وتفاصيل كل خدمة. لأي استفسار تواصل مع الحسابات." : "Your approved monthly statements with every service. Contact accounts with any question."} />
      {c && (
        <section className="card mb-5 p-5 text-sm">
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "عقدك الحالي" : "Your current contract"}</h2>
          <p>{ar ? "النسبة الأساسية" : "Default share"}: <span className="num font-medium">{Number(c.default_percent)}%</span></p>
          {c.rates.length > 0 && <ul className="mt-2 space-y-1 text-ink-500">{c.rates.map((r, i) => <li key={i}>{ar ? r.service.name_ar : r.service.name_en}: <span className="num">{r.fixed_amount != null ? money(r.fixed_amount, ctx.locale) : `${Number(r.percent)}%`}</span></li>)}</ul>}
        </section>
      )}
      <div className="card">
        {(runs ?? []).length === 0 ? <Empty text={ar ? "لا توجد كشوف معتمدة بعد." : "No approved statements yet."} /> : (
          <ul className="divide-y divide-ivory-200">
            {(runs ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/os/my-settlements/${r.id}`} className="font-medium text-navy-700 hover:underline">{monthLabel(r.period, ctx.locale)} <span className="num text-xs text-ink-300">{r.ref}</span></Link>
                <span className="flex items-center gap-3"><span className="num font-medium">{money(r.amount, ctx.locale)}</span>
                  <StatusBadge status={SETTLEMENT_STATUS[r.status]?.[2] ?? "draft"} label={(ar ? SETTLEMENT_STATUS[r.status]?.[0] : SETTLEMENT_STATUS[r.status]?.[1]) ?? r.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
