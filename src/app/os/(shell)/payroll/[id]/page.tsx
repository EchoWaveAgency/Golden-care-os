import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { RUN_STATUS, WARNINGS, lab, minutesText } from "@/lib/hr";
import { approvePayroll, cancelPayroll, payPayroll } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type Run = { id: string; ref: string; period: string; status: string; employees: number; total_earnings: number; total_deductions: number; total_net: number; total_employer: number;
  warnings: { employee?: string; issue: string }[]; prepared_by: string; approved_by: string | null; prepared_at: string; approved_at: string | null; paid_at: string | null;
  payment_reference: string | null; cancel_reason: string | null };
type Slip = { employee_id: string; employed_days: number; worked_days: number; absent_days: number; unpaid_leave_days: number; late_minutes: number; overtime_minutes: number;
  earnings: number; deductions: number; net: number; employer: number; employee: { employee_no: string; payment_method: string; bank_account: string | null; staff: { full_name_ar: string; full_name_en: string | null } | null } | null };

export default async function PayrollRunPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("payroll.read", "payroll.prepare");
  const ar = ctx.locale === "ar";
  const { data: run } = await ctx.supabase.from("payroll_runs").select("*").eq("id", params.id).maybeSingle<Run>();
  if (!run) notFound();
  const [{ data: slips }, { data: comps }, { data: names }] = await Promise.all([
    ctx.supabase.from("payroll_slips").select("*, employee:employees(employee_no, payment_method, bank_account, staff:staff(full_name_ar, full_name_en))").eq("run_id", run.id).returns<Slip[]>(),
    ctx.supabase.from("payroll_lines").select("component_code, kind, amount").eq("run_id", run.id),
    ctx.supabase.from("payroll_components").select("code, name_ar, name_en, sort"),
  ]);
  const cname = new Map((names ?? []).map((c) => [c.code, { label: ar ? c.name_ar : c.name_en, sort: c.sort }]));
  const byComp = new Map<string, { kind: string; amount: number }>();
  for (const c of comps ?? []) { const v = byComp.get(c.component_code) ?? { kind: c.kind, amount: 0 }; v.amount += Number(c.amount); byComp.set(c.component_code, v); }
  const me = ctx.user.id;
  const ok = { prepared: ar ? "تم إعداد الكشف. راجعه ثم يعتمده مسؤول آخر." : "Prepared. Review it; another person approves it.",
    approved: ar ? "تم الاعتماد وتسجيل قيد الاستحقاق." : "Approved; accrual journal posted.", paid: ar ? "تم الصرف وتسجيل القيد." : "Paid and posted.",
    cancelled: ar ? "تم الإلغاء." : "Cancelled." }[searchParams.ok ?? ""];
  const negative = (slips ?? []).some((s) => Number(s.net) < 0);

  return (
    <>
      <PageHeader title={`${ar ? "رواتب" : "Payroll"} ${run.period.slice(0, 7)}`} subtitle={`${run.ref} · ${lab(RUN_STATUS, run.status, ar)}${run.payment_reference ? ` · ${run.payment_reference}` : ""}${run.cancel_reason ? ` · ${run.cancel_reason}` : ""}`}
        actions={<Link href="/os/payroll" className="btn-ghost">{ar ? "كل الكشوف" : "All runs"}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "إجمالي المستحقات" : "Total earnings"} value={money(run.total_earnings, ctx.locale)} />
        <Stat label={ar ? "إجمالي الخصومات" : "Total deductions"} value={money(run.total_deductions, ctx.locale)} tone="gold" />
        <Stat label={ar ? "صافي الرواتب" : "Net pay"} value={money(run.total_net, ctx.locale)} tone="teal" />
        <Stat label={ar ? "حصة صاحب العمل" : "Employer contributions"} value={money(run.total_employer, ctx.locale)} />
      </div>
      {run.warnings.length > 0 && (
        <ul className="mb-5 space-y-1 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm" data-warnings>
          {run.warnings.map((w, i) => <li key={i}>⚠ {w.employee ? <span className="num">{w.employee} · </span> : null}{lab(WARNINGS, w.issue, ar)}</li>)}
        </ul>)}
      <div className="card mb-5 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm" data-slips>
          <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
            <th className="th">{ar ? "الموظف" : "Employee"}</th><th className="th">{ar ? "أيام" : "Days"}</th><th className="th">{ar ? "غياب" : "Absent"}</th><th className="th">{ar ? "تأخير" : "Late"}</th>
            <th className="th">{ar ? "إضافي" : "Overtime"}</th><th className="th">{ar ? "المستحقات" : "Earnings"}</th><th className="th">{ar ? "الخصومات" : "Deductions"}</th>
            <th className="th">{ar ? "الصافي" : "Net"}</th><th className="th"></th></tr></thead>
          <tbody className="divide-y divide-ivory-200">
            {(slips ?? []).map((s) => (
              <tr key={s.employee_id} className={Number(s.net) < 0 ? "bg-danger/5" : ""}>
                <td className="td">{ar ? s.employee?.staff?.full_name_ar : s.employee?.staff?.full_name_en ?? s.employee?.staff?.full_name_ar}<span className="block text-xs text-ink-300 num">{s.employee?.employee_no}</span></td>
                <td className="td num">{s.employed_days}</td><td className="td num">{s.absent_days}{Number(s.unpaid_leave_days) ? ` + ${s.unpaid_leave_days}` : ""}</td>
                <td className="td num">{minutesText(s.late_minutes, ar)}</td><td className="td num">{minutesText(s.overtime_minutes, ar)}</td>
                <td className="td num">{money(s.earnings, ctx.locale)}</td><td className="td num">{money(s.deductions, ctx.locale)}</td>
                <td className="td num font-medium">{money(s.net, ctx.locale)}</td>
                <td className="td"><Link href={`/os/payslip/${run.id}/${s.employee_id}`} className="text-xs text-teal-700 hover:underline">{ar ? "القسيمة" : "Payslip"}</Link></td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4 text-sm">
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "حسب البند" : "By component"}</h2>
          <ul className="space-y-1">{Array.from(byComp.entries()).sort((a, b) => (cname.get(a[0])?.sort ?? 0) - (cname.get(b[0])?.sort ?? 0)).map(([k, v]) => <li key={k} className="flex justify-between"><span title={k}>{cname.get(k)?.label ?? k}</span>
            <span className={v.kind === "deduction" ? "text-danger num" : "num"}>{v.kind === "deduction" ? "−" : ""}{money(v.amount, ctx.locale)}</span></li>)}</ul>
        </div>
        <div className="card space-y-3 p-4 text-sm">
          <p className="text-xs text-ink-500">{ar ? "أُعد " : "Prepared "}{dateTime(run.prepared_at, ctx.locale)}{run.approved_at ? ` · ${ar ? "اعتُمد" : "approved"} ${dateTime(run.approved_at, ctx.locale)}` : ""}{run.paid_at ? ` · ${ar ? "صُرف" : "paid"} ${dateTime(run.paid_at, ctx.locale)}` : ""}</p>
          {run.status === "prepared" && ctx.can("payroll.approve") && (run.prepared_by === me
            ? <p className="text-ink-500">{ar ? "أنت أعددت الكشف؛ يعتمده مسؤول آخر." : "You prepared this run; another person approves it."}</p>
            : <form action={approvePayroll}><input type="hidden" name="run_id" value={run.id} />
                <SubmitButton pendingLabel="…" className="btn-primary" confirm={ar ? "اعتماد الكشف وتسجيل القيد؟" : "Approve and post the journal?"}>{negative ? (ar ? "يوجد صافي سالب" : "Negative net") : (ar ? "اعتماد الكشف" : "Approve payroll")}</SubmitButton></form>)}
          {run.status === "approved" && ctx.can("payroll.pay") && (run.approved_by === me || run.prepared_by === me
            ? <p className="text-ink-500">{ar ? "الصرف يتم بواسطة شخص غير من أعد أو اعتمد." : "Payment is made by someone other than the preparer and approver."}</p>
            : <form action={payPayroll} className="flex flex-wrap items-end gap-2" data-pay-run><input type="hidden" name="run_id" value={run.id} />
                <select name="method" className="input w-36"><option value="bank_transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option><option value="cash">{ar ? "نقدًا" : "Cash"}</option></select>
                <input name="reference" required placeholder={ar ? "مرجع ملف التحويل" : "Transfer batch reference"} className="input w-48" dir="ltr" />
                <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تسجيل الصرف" : "Record payment"}</SubmitButton></form>)}
          {["prepared", "approved"].includes(run.status) && (ctx.can(run.status === "prepared" ? "payroll.prepare" : "payroll.approve")) && (
            <details><summary className="cursor-pointer text-danger">{run.status === "prepared" ? (ar ? "إلغاء لإعادة الإعداد" : "Cancel to prepare again") : (ar ? "إلغاء الاعتماد (يعكس القيد)" : "Reverse the approval")}</summary>
              <form action={cancelPayroll} className="mt-2 flex gap-2"><input type="hidden" name="run_id" value={run.id} />
                <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input" />
                <SubmitButton pendingLabel="…" className="btn-ghost text-danger">{ar ? "تأكيد" : "Confirm"}</SubmitButton></form></details>)}
        </div>
      </div>
    </>
  );
}
