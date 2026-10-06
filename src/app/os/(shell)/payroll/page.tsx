import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { LOAN_STATUS, RUN_STATUS, lab, lastMonth } from "@/lib/hr";
import { decideLoan, disburseLoan, payLiability, preparePayroll, requestLoan, saveAdjustment } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../hr/HrTabs";

export const dynamic = "force-dynamic";

type Run = { id: string; ref: string; period: string; status: string; employees: number; total_earnings: number; total_deductions: number; total_net: number; total_employer: number; warnings: unknown[] };
type Loan = { id: string; ref: string; amount: number; repaid: number; installments: number; start_period: string; reason: string; status: string;
  employee: { staff: { full_name_ar: string; full_name_en: string | null } | null } | null };

export default async function PayrollPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("payroll.read", "payroll.prepare");
  const ar = ctx.locale === "ar";
  const [{ data: runs }, { data: loans }, { data: emps }, { data: adj }, { data: siLines }] = await Promise.all([
    ctx.supabase.from("payroll_runs").select("id, ref, period, status, employees, total_earnings, total_deductions, total_net, total_employer, warnings").order("period", { ascending: false }).limit(24).returns<Run[]>(),
    ctx.supabase.from("employee_loans").select("id, ref, amount, repaid, installments, start_period, reason, status, employee:employees(staff:staff(full_name_ar, full_name_en))")
      .in("status", ["requested", "approved", "disbursed"]).order("created_at", { ascending: false }).returns<Loan[]>(),
    ctx.supabase.from("employees").select("id, employee_no, staff:staff(full_name_ar, full_name_en)").eq("status", "active").eq("payroll_eligible", true).order("employee_no")
      .returns<{ id: string; employee_no: string; staff: { full_name_ar: string; full_name_en: string | null } | null }[]>(),
    ctx.supabase.from("payroll_adjustments").select("id, period, component_code, amount, reason, employee_id").eq("status", "active").order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("payroll_lines").select("component_code, amount, run:payroll_runs!inner(period, status)").in("component_code", ["SI_EMPLOYEE", "SI_EMPLOYER", "INCOME_TAX"]),
  ]);
  const nm = (s: { full_name_ar: string; full_name_en: string | null } | null | undefined) => (ar ? s?.full_name_ar : s?.full_name_en ?? s?.full_name_ar) ?? "";
  const empName = new Map((emps ?? []).map((e) => [e.id, nm(e.staff)]));
  const prepare = ctx.can("payroll.prepare"), approve = ctx.can("payroll.approve"), pay = ctx.can("payroll.pay");
  const lm = lastMonth();
  const due = new Map<string, { si: number; tax: number }>();
  for (const l of (siLines ?? []) as unknown as { component_code: string; amount: number; run: { period: string; status: string } }[]) {
    if (!["approved", "paid"].includes(l.run.status)) continue;
    const k = l.run.period.slice(0, 7); const v = due.get(k) ?? { si: 0, tax: 0 };
    if (l.component_code === "INCOME_TAX") v.tax += Number(l.amount); else v.si += Number(l.amount);
    due.set(k, v);
  }
  const ok = { prepared: "", adjustment: ar ? "تم تسجيل البند." : "Entry recorded.", loan_requested: ar ? "تم طلب السلفة." : "Loan requested.",
    loan_decided: ar ? "تم القرار على السلفة." : "Loan decided.", loan_paid: ar ? "تم صرف السلفة وتسجيل القيد." : "Loan paid out and posted.",
    liability_paid: ar ? "تم تسجيل السداد." : "Payment recorded." }[searchParams.ok ?? ""];

  return (
    <>
      <PageHeader title={ar ? "الرواتب" : "Payroll"} subtitle={ar ? "إعداد ← اعتماد ← صرف، كل خطوة بشخص مختلف. القيود تُسجل تلقائيًا." : "Prepare → approve → pay, each by a different person. Journals post automatically."}
        actions={ctx.can("payroll.settings") ? <Link href="/os/payroll/settings" className="btn-ghost">{ar ? "إعدادات الرواتب" : "Payroll settings"}</Link> : undefined} />
      <HrTabs active="payroll" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={ok || undefined} />

      {prepare && (
        <form action={preparePayroll} className="card mb-5 flex flex-wrap items-end gap-3 p-4 text-sm" data-prepare>
          <label><span className="label">{ar ? "الشهر" : "Month"}</span><input name="period" type="month" required defaultValue={lm} className="input" /></label>
          <SubmitButton pendingLabel={ar ? "جاري الحساب…" : "Calculating…"}>{ar ? "إعداد كشف الرواتب" : "Prepare payroll"}</SubmitButton>
          <p className="text-xs text-ink-500">{ar ? "يعيد حساب الحضور للشهر، ثم يحسب الأساسي والبدلات والإضافي والخصومات والتأمينات والضريبة والسلف." : "Recomputes the month's attendance, then basic, allowances, overtime, deductions, insurance, tax and loans."}</p>
        </form>)}

      <section className="mb-6">
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "كشوف الرواتب" : "Payroll runs"}</h2>
        <ul className="card divide-y divide-ivory-200 text-sm" data-runs>
          {(runs ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
          {(runs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <Link href={`/os/payroll/${r.id}`} className="text-navy-700 hover:underline"><span className="num font-medium">{r.period.slice(0, 7)}</span> · <span className="num text-xs text-ink-500">{r.ref}</span>
                <span className="block text-xs text-ink-500">{lab(RUN_STATUS, r.status, ar)} · {r.employees} {ar ? "موظف" : "employees"}{r.warnings.length ? ` · ⚠ ${r.warnings.length}` : ""}</span></Link>
              <span className="text-end"><span className="num font-medium">{money(r.total_net, ctx.locale)}</span><span className="block text-xs text-ink-500">{ar ? "الصافي" : "net"}</span></span>
            </li>))}
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "مكافآت وجزاءات الشهر" : "Bonuses and penalties"}</h2>
          {prepare && (
            <form action={saveAdjustment} className="card mb-3 grid gap-2 p-4 text-sm md:grid-cols-2" data-adjustment>
              <select name="employee_id" required className="input">{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{nm(e.staff)}</option>)}</select>
              <select name="component" className="input"><option value="BONUS">{ar ? "مكافأة" : "Bonus"}</option><option value="PENALTY">{ar ? "جزاء" : "Penalty"}</option></select>
              <input name="period" type="month" required defaultValue={lm} className="input" />
              <input name="amount" type="number" min="0.01" step="0.01" required placeholder={ar ? "المبلغ" : "Amount"} className="input num" />
              <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input md:col-span-2" />
              <SubmitButton pendingLabel="…" className="btn-ghost md:col-span-2">{ar ? "تسجيل" : "Record"}</SubmitButton>
            </form>)}
          <ul className="space-y-1 text-xs">{(adj ?? []).map((a) => <li key={a.id}>{empName.get(a.employee_id) ?? ""} · <span className="num">{a.period.slice(0, 7)}</span> · {a.component_code === "BONUS" ? (ar ? "مكافأة" : "bonus") : (ar ? "جزاء" : "penalty")} <span className="num">{money(a.amount, ctx.locale)}</span> · {a.reason}</li>)}</ul>
        </section>

        <section>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "السلف" : "Loans"}</h2>
          {prepare && (
            <form action={requestLoan} className="card mb-3 grid gap-2 p-4 text-sm md:grid-cols-2" data-loan-form>
              <select name="employee_id" required className="input">{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{nm(e.staff)}</option>)}</select>
              <input name="amount" type="number" min="1" step="0.01" required placeholder={ar ? "المبلغ" : "Amount"} className="input num" />
              <label className="flex items-center gap-2"><span className="text-xs">{ar ? "أقساط" : "Installments"}</span><input name="installments" type="number" min="1" max="60" defaultValue={3} className="input num w-20" /></label>
              <label className="flex items-center gap-2"><span className="text-xs">{ar ? "من شهر" : "From"}</span><input name="start" type="month" required defaultValue={lm} className="input" /></label>
              <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input md:col-span-2" />
              <SubmitButton pendingLabel="…" className="btn-ghost md:col-span-2">{ar ? "طلب سلفة" : "Request loan"}</SubmitButton>
            </form>)}
          <ul className="card divide-y divide-ivory-200 text-sm">
            {(loans ?? []).length === 0 && <li className="px-4 py-2 text-ink-300">{ctx.t("common.none")}</li>}
            {(loans ?? []).map((l) => (
              <li key={l.id} className="space-y-1 px-4 py-2" data-loan={l.ref}>
                <p>{nm(l.employee?.staff)} · <span className="num">{money(l.amount, ctx.locale)}</span> / {l.installments} · {lab(LOAN_STATUS, l.status, ar)}
                  {l.status === "disbursed" && <span className="text-xs text-ink-500"> · {ar ? "مسدد" : "repaid"} <span className="num">{money(l.repaid, ctx.locale)}</span></span>}</p>
                <p className="text-xs text-ink-500">{l.reason}</p>
                {approve && l.status === "requested" && (
                  <form action={decideLoan} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={l.id} />
                    <input name="note" placeholder={ar ? "ملاحظة للرفض" : "Note to reject"} className="input w-40 py-1 text-xs" />
                    <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                    <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "رفض" : "Reject"}</SubmitButton></form>)}
                {pay && l.status === "approved" && (
                  <form action={disburseLoan} className="flex flex-wrap gap-2"><input type="hidden" name="id" value={l.id} />
                    <select name="method" className="input w-32 py-1 text-xs"><option value="bank_transfer">{ar ? "تحويل" : "Transfer"}</option><option value="cash">{ar ? "نقدًا" : "Cash"}</option></select>
                    <input name="reference" required placeholder={ar ? "المرجع" : "Reference"} className="input w-32 py-1 text-xs" dir="ltr" />
                    <SubmitButton pendingLabel="…" className="btn-gold px-2 py-1 text-xs">{ar ? "صرف" : "Pay out"}</SubmitButton></form>)}
              </li>))}
          </ul>
        </section>
      </div>

      {due.size > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "التأمينات والضرائب المستحقة من الرواتب" : "Insurance and tax due from payroll"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">{Array.from(due.entries()).sort().reverse().map(([m, v]) => (
            <li key={m} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
              <span className="num">{m}</span>
              <span>{ar ? "تأمينات" : "Insurance"} <span className="num">{money(v.si, ctx.locale)}</span> · {ar ? "ضريبة" : "Tax"} <span className="num">{money(v.tax, ctx.locale)}</span></span>
              {pay && <form action={payLiability} className="flex flex-wrap gap-2"><input type="hidden" name="period" value={m} />
                <select name="kind" className="input w-32 py-1 text-xs"><option value="social_insurance">{ar ? "تأمينات" : "Insurance"}</option><option value="payroll_tax">{ar ? "ضريبة" : "Tax"}</option></select>
                <input name="amount" type="number" min="0.01" step="0.01" required className="input num w-28 py-1 text-xs" />
                <input name="reference" required placeholder={ar ? "رقم الإيصال" : "Receipt no."} className="input w-28 py-1 text-xs" dir="ltr" />
                <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "تسجيل السداد" : "Record payment"}</SubmitButton></form>}
            </li>))}</ul>
        </section>)}
    </>
  );
}
