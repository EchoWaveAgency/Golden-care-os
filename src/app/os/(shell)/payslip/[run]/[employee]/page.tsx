import { notFound } from "next/navigation";
import { getContext } from "@/lib/session";
import { money } from "@/lib/format";
import { minutesText } from "@/lib/hr";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

// Payslip: payroll staff see any; an employee sees their own once the run is approved (RLS decides).
export default async function PayslipPage({ params }: { params: { run: string; employee: string } }) {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  const [{ data: slip }, { data: lines }, { data: emp }, { data: comps }] = await Promise.all([
    ctx.supabase.from("payroll_slips").select("*").eq("run_id", params.run).eq("employee_id", params.employee).maybeSingle(),
    ctx.supabase.from("payroll_lines").select("component_code, kind, quantity, amount, note").eq("run_id", params.run).eq("employee_id", params.employee),
    ctx.supabase.from("employees").select("employee_no, job_title_ar, job_title_en, insurance_no, staff:staff(full_name_ar, full_name_en)").eq("id", params.employee).maybeSingle(),
    ctx.supabase.from("payroll_components").select("code, name_ar, name_en, sort"),
  ]);
  if (!slip) notFound();
  const { data: run } = await ctx.supabase.from("payroll_runs").select("period, ref").eq("id", params.run).maybeSingle();
  const period = run?.period?.slice(0, 7) ?? "";
  const cname = new Map((comps ?? []).map((c) => [c.code, ar ? c.name_ar : c.name_en]));
  const sort = new Map((comps ?? []).map((c) => [c.code, c.sort]));
  const of = (k: string) => (lines ?? []).filter((l) => l.kind === k).sort((a, b) => (sort.get(a.component_code) ?? 0) - (sort.get(b.component_code) ?? 0));
  const staff = (emp as { staff?: { full_name_ar: string; full_name_en: string | null } | null } | null)?.staff;
  return (
    <div className="mx-auto max-w-2xl" data-payslip>
      <div className="mb-4 flex justify-end print:hidden"><PrintButton label={ar ? "طباعة" : "Print"} /></div>
      <article className="card p-6 text-sm print:border-0 print:shadow-none">
        <header className="mb-4 flex items-start justify-between border-b border-ivory-200 pb-3">
          <div><p className="text-lg font-semibold text-navy-700">{ar ? "قسيمة راتب" : "Payslip"} · <span className="num">{period}</span></p>
            <p>{ar ? staff?.full_name_ar : staff?.full_name_en ?? staff?.full_name_ar} · <span className="num">{emp?.employee_no}</span></p>
            <p className="text-xs text-ink-500">{(ar ? emp?.job_title_ar : emp?.job_title_en ?? emp?.job_title_ar) ?? ""}{emp?.insurance_no ? ` · ${ar ? "رقم تأميني" : "Insurance no."} ${emp.insurance_no}` : ""}</p></div>
          <div className="text-end"><p className="font-semibold text-gold-700">{ar ? "عيادات جولدن كير" : "Golden Care Clinics"}</p><p className="num text-xs text-ink-500">{run?.ref}</p></div>
        </header>
        <p className="mb-3 text-xs text-ink-500">{ar ? "أيام الخدمة" : "Days employed"} {slip.employed_days} · {ar ? "غياب" : "absent"} {slip.absent_days} · {ar ? "تأخير" : "late"} {minutesText(slip.late_minutes, ar)} · {ar ? "إضافي" : "overtime"} {minutesText(slip.overtime_minutes, ar)}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section><h2 className="mb-1 font-medium text-teal-700">{ar ? "المستحقات" : "Earnings"}</h2>
            <ul className="space-y-1">{of("earning").map((l, i) => <li key={i} className="flex justify-between"><span>{cname.get(l.component_code)}{l.note ? <span className="text-xs text-ink-500"> ({l.note})</span> : null}</span><span className="num">{money(l.amount, ctx.locale)}</span></li>)}</ul>
            <p className="mt-2 flex justify-between border-t border-ivory-200 pt-1 font-medium"><span>{ar ? "الإجمالي" : "Total"}</span><span className="num">{money(slip.earnings, ctx.locale)}</span></p></section>
          <section><h2 className="mb-1 font-medium text-danger">{ar ? "الخصومات" : "Deductions"}</h2>
            <ul className="space-y-1">{of("deduction").map((l, i) => <li key={i} className="flex justify-between"><span>{cname.get(l.component_code)}{l.note ? <span className="text-xs text-ink-500"> ({l.note})</span> : null}</span><span className="num">{money(l.amount, ctx.locale)}</span></li>)}</ul>
            <p className="mt-2 flex justify-between border-t border-ivory-200 pt-1 font-medium"><span>{ar ? "الإجمالي" : "Total"}</span><span className="num">{money(slip.deductions, ctx.locale)}</span></p></section>
        </div>
        <p className="mt-5 flex justify-between rounded-xl bg-teal-50 px-4 py-3 text-base font-semibold text-teal-800"><span>{ar ? "صافي الراتب" : "Net pay"}</span><span className="num">{money(slip.net, ctx.locale)}</span></p>
        {Number(slip.employer) > 0 && <p className="mt-2 text-xs text-ink-500">{ar ? "حصة صاحب العمل في التأمينات (للعلم): " : "Employer insurance contribution (for information): "}<span className="num">{money(slip.employer, ctx.locale)}</span></p>}
      </article>
    </div>
  );
}
