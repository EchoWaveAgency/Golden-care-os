import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { SETTLEMENT_STATUS } from "@/components/SettlementStatement";
import { prepareSettlement, payWithholdingTax } from "@/app/actions/settlements";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Doctor settlements" };
export const dynamic = "force-dynamic";

type Doc = { id: string; full_name_ar: string; full_name_en: string | null; specialty: { name_ar: string; name_en: string } | null };

function cairoMonth(offset = 0) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1));
  return d.toISOString().slice(0, 7);
}

export default async function SettlementsPage({ searchParams }: { searchParams: { m?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("settlement.prepare", "settlement.approve", "settlement.pay", "contract.manage");
  const ar = ctx.locale === "ar";
  const month = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m! : cairoMonth(-1);
  const first = `${month}-01`;
  const [{ data: doctors }, { data: runs }, { data: contracts }] = await Promise.all([
    ctx.supabase.from("staff").select("id, full_name_ar, full_name_en, specialty:specialties(name_ar, name_en)").eq("kind", "doctor").eq("is_active", true).order("full_name_ar").returns<Doc[]>(),
    ctx.supabase.from("settlement_runs").select("id, doctor_id, status, amount, period").neq("status", "cancelled").eq("period", `[${first},${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) , 1)).toISOString().slice(0, 10)})`),
    ctx.supabase.from("doctor_contracts").select("doctor_id, valid, default_percent"),
  ]);
  const runOf = new Map((runs ?? []).map((r) => [r.doctor_id, r]));
  const contractOn = (doctor: string) => (contracts ?? []).find((c) => {
    const [lo, hi] = String(c.valid).replace(/[[()\]]/g, "").split(",");
    return c.doctor_id === doctor && lo <= first && (!hi || first < hi);
  });
  const total = (runs ?? []).reduce((a, r) => a + Number(r.amount), 0);
  const canPay = ctx.can("settlement.pay");
  const [{ data: whtDue }, { data: remits }] = canPay ? await Promise.all([
    ctx.supabase.rpc("withholding_due", { p_branch: ctx.branchId }),
    ctx.supabase.from("tax_remittances").select("id, ref, period, amount, reference, paid_at").order("paid_at", { ascending: false }).limit(6),
  ]) : [{ data: null }, { data: [] }];
  const months = [-3, -2, -1, 0].map(cairoMonth);

  return (
    <>
      <PageHeader title={ctx.t("nav.settlements")} subtitle={ar ? "الكشف يُحسب من الفواتير الصادرة بعد خصومات البنود، ويخصم نصيب الطبيب من المرتجعات والفواتير الملغاة. يعدّه محاسب ويعتمده مسؤول آخر." : "Computed from issued invoices net of line discounts, minus the doctor's share of refunds and voids. Prepared by one person, approved by another."} />
      <Banner error={searchParams.error} success={searchParams.ok === "wht_paid" ? (ar ? "تم تسجيل سداد ضريبة الخصم من المنبع." : "Withholding tax remittance recorded.") : undefined} />
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        {months.map((m) => <Link key={m} href={`/os/settlements?m=${m}`} className={`num rounded-full px-3 py-1.5 text-sm ${m === month ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{m}</Link>)}
        <span className="ms-auto text-sm text-ink-500">{ar ? "إجمالي الكشوف" : "Total of statements"}: <span className="num font-semibold text-navy-700">{money(total, ctx.locale)}</span></span>
      </nav>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-ivory-200 bg-ivory-50">
            <tr><th className="th">{ar ? "الطبيب" : "Doctor"}</th><th className="th">{ar ? "العقد في هذا الشهر" : "Contract this month"}</th>
              <th className="th">{ar ? "الكشف" : "Statement"}</th><th className="th">{ar ? "المستحق" : "Due"}</th><th className="th" /></tr>
          </thead>
          <tbody className="divide-y divide-ivory-200">
            {(doctors ?? []).map((d) => {
              const run = runOf.get(d.id);
              const c = contractOn(d.id);
              const st = run ? SETTLEMENT_STATUS[run.status] : null;
              return (
                <tr key={d.id} className="hover:bg-ivory-50">
                  <td className="td"><span className="font-medium">{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</span><span className="block text-xs text-ink-300">{ar ? d.specialty?.name_ar : d.specialty?.name_en}</span></td>
                  <td className="td">{c ? <span className="num">{Number(c.default_percent)}%</span> : <span className="text-danger">{ar ? "لا يوجد عقد" : "No contract"}</span>}
                    {ctx.can("contract.manage") && <Link href={`/os/settlements/contracts/${d.id}`} className="ms-2 text-xs text-teal-700 hover:underline">{ar ? "العقود" : "Contracts"}</Link>}</td>
                  <td className="td">{run ? <Link href={`/os/settlements/${run.id}`} className="hover:underline"><StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? run.status} /></Link> : <span className="text-ink-300">—</span>}</td>
                  <td className="td num font-medium">{run ? money(run.amount, ctx.locale) : ""}</td>
                  <td className="td">
                    {!run && ctx.can("settlement.prepare") && (
                      <form action={prepareSettlement}><input type="hidden" name="doctor_id" value={d.id} /><input type="hidden" name="month" value={month} />
                        <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{ar ? "إعداد الكشف" : "Prepare"}</SubmitButton></form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canPay && (
        <section className="card mt-6 p-5 text-sm" data-withholding>
          <h2 className="mb-1 font-medium text-navy-700">{ar ? "ضريبة الخصم من المنبع على أتعاب الأطباء" : "Withholding tax on doctors' fees"}</h2>
          <p className="mb-3 text-ink-500">{ar ? "المستحق للمصلحة حتى الآن:" : "Due to the Tax Authority so far:"} <span className="num font-semibold text-navy-700">{money(Number(whtDue ?? 0), ctx.locale)}</span></p>
          {Number(whtDue ?? 0) > 0 && (
            <form action={payWithholdingTax} className="flex flex-wrap items-end gap-2">
              <input name="period" required defaultValue={month} pattern="\d{4}-\d{2}" className="input num w-28" dir="ltr" aria-label={ar ? "الفترة" : "Period"} />
              <input name="amount" type="number" step="0.01" min="0.01" max={Number(whtDue)} required defaultValue={Number(whtDue)} className="input num w-32" aria-label={ar ? "المبلغ" : "Amount"} />
              <input name="reference" required placeholder={ar ? "رقم السداد / التحويل" : "Payment reference"} className="input w-48" dir="ltr" />
              <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تسجيل السداد" : "Record remittance"}</SubmitButton>
            </form>)}
          {(remits ?? []).length > 0 && <ul className="mt-3 divide-y divide-ivory-200 text-xs text-ink-500">{(remits ?? []).map((r) => (
            <li key={r.id} className="py-1.5"><span className="num">{r.ref}</span> · <span className="num">{r.period}</span> · <span className="num">{money(r.amount, ctx.locale)}</span> · <span className="num">{r.reference}</span> · {dateTime(r.paid_at, ctx.locale)}</li>))}</ul>}
        </section>)}
    </>
  );
}
