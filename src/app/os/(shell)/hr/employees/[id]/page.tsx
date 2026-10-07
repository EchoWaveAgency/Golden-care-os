import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { ATT_STATUS, LEAVE_STATUS, LOAN_STATUS, lab, minutesText } from "@/lib/hr";
import { endEmployment, requestLeave, saveEmployee, prepareEos, decideEos, payEos } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../../HrTabs";

export const dynamic = "force-dynamic";

type E = { id: string; employee_no: string; staff_id: string; job_title_ar: string | null; job_title_en: string | null; department: string | null; employment_type: string;
  hire_date: string; end_date: string | null; end_reason: string | null; status: string; national_id: string | null; insurance_no: string | null; insured_wage: number | null;
  payment_method: string; bank_name: string | null; bank_account: string | null; biometric_id: string | null; shift_id: string | null; payroll_eligible: boolean;
  annual_leave_days: number | null; staff: { full_name_ar: string; full_name_en: string | null } | null };

export default async function EmployeePage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("hr.read", "hr.manage", "payroll.read");
  const ar = ctx.locale === "ar";
  const { data: e } = await ctx.supabase.from("employees").select("*, staff:staff(full_name_ar, full_name_en)").eq("id", params.id).maybeSingle<E>();
  if (!e) notFound();
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
  const [{ data: items }, { data: shifts }, { data: att }, { data: leaves }, { data: bal }, { data: loans }, { data: types }] = await Promise.all([
    ctx.supabase.from("employee_pay_items").select("id, component_code, amount, effective, note").eq("employee_id", e.id).order("created_at", { ascending: false }),
    ctx.supabase.from("shifts").select("id, name_ar, name_en, start_time, end_time").eq("is_active", true),
    ctx.supabase.from("attendance_days").select("day, status, late_minutes, overtime_minutes").eq("employee_id", e.id).gte("day", `${month}-01`).order("day"),
    ctx.supabase.from("leave_requests").select("id, ref, leave_type, from_date, to_date, days, status").eq("employee_id", e.id).order("from_date", { ascending: false }).limit(10),
    ctx.supabase.rpc("my_leave_balances", { p_employee: e.id }),
    ctx.supabase.from("employee_loans").select("id, ref, amount, repaid, installments, status").eq("employee_id", e.id).order("created_at", { ascending: false }),
    ctx.supabase.from("leave_types").select("code, name_ar, name_en").eq("is_active", true),
  ]);
  const manage = ctx.can("hr.manage");
  const { data: eos } = await ctx.supabase.from("eos_settlements").select("*").eq("employee_id", e.id).neq("status", "cancelled").maybeSingle();
  const current = (code: string) => (items ?? []).find((i) => i.component_code === code && String(i.effective).includes(",)"))?.amount;
  const count = (st: string) => (att ?? []).filter((a) => a.status === st).length;
  const ok = { saved: ar ? "تم الحفظ." : "Saved.", ended: ar ? "تم إنهاء الخدمة." : "Employment ended.", leave_requested: ar ? "تم تسجيل طلب الإجازة." : "Leave requested.",
    eos_prepared: ar ? "تم إعداد تسوية نهاية الخدمة — تنتظر الاعتماد." : "End-of-service settlement prepared — awaiting approval.", eos_approved: ar ? "تم اعتماد التسوية وترحيل القيد." : "Settlement approved and posted.",
    eos_paid: ar ? "تم صرف التسوية." : "Settlement paid.", eos_cancelled: ar ? "تم إلغاء التسوية." : "Settlement cancelled." }[searchParams.ok ?? ""];
  const name = ar ? e.staff?.full_name_ar : e.staff?.full_name_en ?? e.staff?.full_name_ar;
  const field = (n: keyof E, label: string, opts: { type?: string; ltr?: boolean; w?: string } = {}) => (
    <label><span className="label">{label}</span><input name={n} type={opts.type ?? "text"} defaultValue={(e[n] as string | number | null) ?? ""} disabled={!manage}
      className={`input ${opts.w ?? ""}`} dir={opts.ltr ? "ltr" : undefined} step={opts.type === "number" ? "0.01" : undefined} /></label>);

  return (
    <>
      <PageHeader title={name ?? ""} subtitle={`${e.employee_no} · ${(ar ? e.job_title_ar : e.job_title_en ?? e.job_title_ar) ?? ""}${e.status === "terminated" ? ` · ${ar ? "انتهت خدمته" : "left"} ${e.end_date}` : ""}`}
        actions={<Link href="/os/hr" className="btn-ghost">{ar ? "كل الموظفين" : "All employees"}</Link>} />
      <HrTabs active="employees" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={ok} />
      <div className="grid gap-5 lg:grid-cols-3">
        <form action={saveEmployee} className="card space-y-4 p-5 text-sm lg:col-span-2" data-employee-form>
          <input type="hidden" name="id" value={e.id} /><input type="hidden" name="payroll_flag" value="1" />
          <h2 className="font-medium text-navy-700">{ar ? "بيانات الوظيفة" : "Job"}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {field("job_title_ar", ar ? "الوظيفة (عربي)" : "Job title (Arabic)")}
            {field("job_title_en", ar ? "الوظيفة (إنجليزي)" : "Job title (English)")}
            {field("department", ar ? "القسم" : "Department")}
            <label><span className="label">{ar ? "نوع التعاقد" : "Employment"}</span>
              <select name="employment_type" defaultValue={e.employment_type} disabled={!manage} className="input">
                <option value="full_time">{ar ? "دوام كامل" : "Full time"}</option><option value="part_time">{ar ? "دوام جزئي" : "Part time"}</option>
                <option value="contract">{ar ? "عقد مؤقت" : "Contract"}</option><option value="intern">{ar ? "متدرب" : "Intern"}</option></select></label>
            {field("hire_date", ar ? "تاريخ التعيين" : "Hire date", { type: "date" })}
            <label><span className="label">{ar ? "الوردية" : "Shift"}</span>
              <select name="shift_id" defaultValue={e.shift_id ?? ""} disabled={!manage} className="input"><option value="">—</option>
                {(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{(ar ? s.name_ar : s.name_en ?? s.name_ar)} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})</option>)}</select></label>
            {field("biometric_id", ar ? "رقم البصمة" : "Biometric id", { ltr: true })}
            {field("annual_leave_days", ar ? "رصيد الاعتيادي السنوي (أيام)" : "Annual leave days", { type: "number" })}
            <label className="flex items-center gap-2 pt-6"><input type="checkbox" name="payroll_eligible" defaultChecked={e.payroll_eligible} disabled={!manage} />{ar ? "على كشف الرواتب" : "On payroll"}</label>
          </div>
          <h2 className="font-medium text-navy-700">{ar ? "التأمينات والبنك" : "Insurance and bank"}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {field("national_id", ar ? "الرقم القومي" : "National id", { ltr: true })}
            {field("insurance_no", ar ? "الرقم التأميني" : "Insurance no.", { ltr: true })}
            {field("insured_wage", ar ? "الأجر التأميني" : "Insured wage", { type: "number" })}
            <label><span className="label">{ar ? "طريقة صرف الراتب" : "Paid by"}</span>
              <select name="payment_method" defaultValue={e.payment_method} disabled={!manage} className="input">
                <option value="bank_transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option><option value="cash">{ar ? "نقدًا" : "Cash"}</option><option value="wallet">{ar ? "محفظة" : "Wallet"}</option></select></label>
            {field("bank_name", ar ? "البنك" : "Bank")}
            {field("bank_account", ar ? "رقم الحساب / IBAN" : "Account / IBAN", { ltr: true })}
          </div>
          <h2 className="font-medium text-navy-700">{ar ? "الراتب" : "Salary"}</h2>
          <p className="text-xs text-ink-500">{ar ? "الحالي: أساسي " : "Current: basic "}<span className="num">{current("BASIC") != null ? money(current("BASIC")!, ctx.locale) : "—"}</span>
            {" · "}{ar ? "سكن " : "housing "}<span className="num">{current("HOUSING") != null ? money(current("HOUSING")!, ctx.locale) : "—"}</span>
            {" · "}{ar ? "انتقال " : "transport "}<span className="num">{current("TRANSPORT") != null ? money(current("TRANSPORT")!, ctx.locale) : "—"}</span></p>
          {manage && (
            <div className="grid gap-3 md:grid-cols-4">
              <label><span className="label">{ar ? "أساسي جديد" : "New basic"}</span><input name="basic_salary" type="number" min="0" step="0.01" className="input num" /></label>
              <label><span className="label">{ar ? "بدل سكن" : "Housing"}</span><input name="housing" type="number" min="0" step="0.01" className="input num" /></label>
              <label><span className="label">{ar ? "بدل انتقال" : "Transport"}</span><input name="transport" type="number" min="0" step="0.01" className="input num" /></label>
              <label><span className="label">{ar ? "يسري من" : "Effective from"}</span><input name="salary_from" type="date" className="input" /></label>
            </div>)}
          {manage && <SubmitButton pendingLabel="…">{ar ? "حفظ" : "Save"}</SubmitButton>}
          {(items ?? []).length > 0 && (
            <ul className="space-y-1 border-t border-ivory-200 pt-3 text-xs text-ink-500">
              {(items ?? []).map((i) => <li key={i.id}><span className="num">{i.component_code} · {money(i.amount, ctx.locale)} · {String(i.effective).replace(/[[\])]/g, "").replace(",", " → ")}</span></li>)}
            </ul>)}
        </form>
        <aside className="space-y-4 text-sm">
          <div className="card p-4" data-attendance-month>
            <h2 className="mb-2 font-medium text-navy-700">{ar ? "حضور الشهر الحالي" : "This month's attendance"}</h2>
            <div className="flex flex-wrap gap-1">
              {(att ?? []).map((a) => <span key={a.day} title={`${a.day} ${lab(ATT_STATUS, a.status, ar)}${a.late_minutes ? ` +${a.late_minutes}` : ""}`}
                className={`grid h-7 w-7 place-items-center rounded text-xs ${ATT_STATUS[a.status]?.tone}`}>{ATT_STATUS[a.status]?.short}</span>)}
            </div>
            <p className="mt-2 text-xs text-ink-500">{ar ? "غياب" : "Absent"} {count("absent")} · {ar ? "تأخير" : "Late"} {count("late")} ({minutesText((att ?? []).reduce((x, a) => x + a.late_minutes, 0), ar)})</p>
          </div>
          <div className="card p-4" data-leave-balances>
            <h2 className="mb-2 font-medium text-navy-700">{ar ? "أرصدة الإجازات" : "Leave balances"}</h2>
            <ul className="space-y-1">{((bal ?? []) as { leave_type: string; name_ar: string; name_en: string; entitled: number | null; used: number; remaining: number | null }[]).map((b) => (
              <li key={b.leave_type} className="flex justify-between"><span>{ar ? b.name_ar : b.name_en}</span>
                <span className="num">{b.entitled == null ? (ar ? `${b.used} (الرصيد غير محدد)` : `${b.used} used (no entitlement set)`) : `${b.remaining} / ${b.entitled}`}</span></li>))}</ul>
            {manage && e.status === "active" && (
              <form action={requestLeave} className="mt-3 space-y-2 border-t border-ivory-200 pt-3">
                <input type="hidden" name="employee_id" value={e.id} /><input type="hidden" name="back" value={`/os/hr/employees/${e.id}`} />
                <select name="leave_type" className="input">{(types ?? []).map((t) => <option key={t.code} value={t.code}>{ar ? t.name_ar : t.name_en}</option>)}</select>
                <div className="flex gap-2"><input name="from" type="date" required className="input" /><input name="to" type="date" required className="input" /></div>
                <input name="reason" placeholder={ar ? "السبب" : "Reason"} className="input" />
                <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "تسجيل إجازة نيابة عنه" : "Record leave for them"}</SubmitButton>
              </form>)}
            <ul className="mt-3 space-y-1 text-xs">{(leaves ?? []).map((l) => <li key={l.id}><span className="num">{l.from_date} → {l.to_date}</span> · {l.days} · {lab(LEAVE_STATUS, l.status, ar)}</li>)}</ul>
          </div>
          {(loans ?? []).length > 0 && (
            <div className="card p-4">
              <h2 className="mb-2 font-medium text-navy-700">{ar ? "السلف" : "Loans"}</h2>
              <ul className="space-y-1 text-xs">{(loans ?? []).map((l) => <li key={l.id} className="flex justify-between"><span className="num">{l.ref}</span>
                <span><span className="num">{money(l.repaid, ctx.locale)} / {money(l.amount, ctx.locale)}</span> · {lab(LOAN_STATUS, l.status, ar)}</span></li>)}</ul>
            </div>)}
          {manage && e.status !== "terminated" && (
            <details className="card p-4">
              <summary className="cursor-pointer text-danger">{ar ? "إنهاء الخدمة" : "End employment"}</summary>
              <form action={endEmployment} className="mt-3 space-y-2"><input type="hidden" name="id" value={e.id} />
                <input name="end_date" type="date" required className="input" /><input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input" />
                <SubmitButton pendingLabel="…" className="btn-ghost w-full text-danger" confirm={ar ? "تأكيد إنهاء الخدمة؟" : "Confirm ending employment?"}>{ar ? "تأكيد" : "Confirm"}</SubmitButton></form>
            </details>)}
          {e.status === "terminated" && (eos || ctx.can("payroll.prepare")) && (
            <div className="card p-4 text-sm" data-eos>
              <h2 className="mb-2 font-medium text-navy-700">{ar ? "تسوية نهاية الخدمة" : "End-of-service settlement"}</h2>
              {eos ? (<>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between"><dt>{ar ? `رصيد إجازات (${Number(eos.leave_days)} يوم)` : `Leave balance (${Number(eos.leave_days)} days)`}</dt><dd className="num">{money(eos.leave_amount, ctx.locale)}</dd></div>
                  <div className="flex justify-between"><dt>{ar ? "مكافأة نهاية الخدمة" : "Gratuity"}</dt><dd className="num">{money(eos.gratuity, ctx.locale)}</dd></div>
                  {Number(eos.other_earnings) > 0 && <div className="flex justify-between"><dt>{ar ? "مستحقات أخرى" : "Other earnings"}</dt><dd className="num">{money(eos.other_earnings, ctx.locale)}</dd></div>}
                  {Number(eos.loan_deduction) > 0 && <div className="flex justify-between"><dt>{ar ? "خصم سلف" : "Loans deducted"}</dt><dd className="num">-{money(eos.loan_deduction, ctx.locale)}</dd></div>}
                  {Number(eos.tax_deduction) > 0 && <div className="flex justify-between"><dt>{ar ? "ضريبة" : "Tax"}</dt><dd className="num">-{money(eos.tax_deduction, ctx.locale)}</dd></div>}
                  {Number(eos.other_deductions) > 0 && <div className="flex justify-between"><dt>{ar ? "استقطاعات أخرى" : "Other deductions"}</dt><dd className="num">-{money(eos.other_deductions, ctx.locale)}</dd></div>}
                  <div className="flex justify-between border-t border-ivory-300 pt-1 font-semibold"><dt>{ar ? "الصافي" : "Net"}</dt><dd className="num">{money(eos.net, ctx.locale)}</dd></div>
                </dl>
                <p className="mt-2 text-xs text-ink-500">{eos.ref} · {eos.status === "draft" ? (ar ? "بانتظار الاعتماد" : "awaiting approval") : eos.status === "approved" ? (ar ? "معتمدة — بانتظار الصرف" : "approved — to pay") : (ar ? "مصروفة" : "paid")}</p>
                {eos.status === "draft" && ctx.can("payroll.approve") && eos.prepared_by !== ctx.user.id && (
                  <form action={decideEos} className="mt-2"><input type="hidden" name="employee_id" value={e.id} /><input type="hidden" name="eos_id" value={eos.id} />
                    <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary w-full">{ar ? "اعتماد وترحيل" : "Approve and post"}</SubmitButton></form>)}
                {eos.status === "draft" && (ctx.can("payroll.prepare") || ctx.can("payroll.approve")) && (
                  <form action={decideEos} className="mt-2 flex gap-2"><input type="hidden" name="employee_id" value={e.id} /><input type="hidden" name="eos_id" value={eos.id} />
                    <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input py-1 text-xs" />
                    <SubmitButton name="decision" value="cancel" pendingLabel="…" className="btn-ghost text-xs">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>)}
                {eos.status === "approved" && ctx.can("payroll.pay") && eos.approved_by !== ctx.user.id && (
                  <form action={payEos} className="mt-2 space-y-2"><input type="hidden" name="employee_id" value={e.id} /><input type="hidden" name="eos_id" value={eos.id} />
                    <select name="method" className="input"><option value="bank_transfer">{ar ? "تحويل بنكي" : "Bank transfer"}</option><option value="cash">{ar ? "نقدًا" : "Cash"}</option></select>
                    <input name="reference" required placeholder={ar ? "المرجع" : "Reference"} className="input" dir="ltr" />
                    <SubmitButton pendingLabel="…" className="btn-gold w-full">{ar ? "صرف" : "Pay"}</SubmitButton></form>)}
              </>) : (
                <form action={prepareEos} className="space-y-2"><input type="hidden" name="employee_id" value={e.id} />
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="encash" defaultChecked />{ar ? "صرف رصيد الإجازات غير المستخدم" : "Pay unused leave balance"}</label>
                  <label className="block"><span className="label">{ar ? "مكافأة نهاية الخدمة (حسب العقد / القانون)" : "Gratuity (per contract / law)"}</span><input name="gratuity" type="number" min="0" step="0.01" defaultValue={0} className="input num" /></label>
                  <label className="block"><span className="label">{ar ? "مستحقات أخرى" : "Other earnings"}</span><input name="other_earnings" type="number" min="0" step="0.01" defaultValue={0} className="input num" /></label>
                  <label className="block"><span className="label">{ar ? "ضريبة مستقطعة" : "Tax withheld"}</span><input name="tax" type="number" min="0" step="0.01" defaultValue={0} className="input num" /></label>
                  <label className="block"><span className="label">{ar ? "استقطاعات أخرى" : "Other deductions"}</span><input name="other_deductions" type="number" min="0" step="0.01" defaultValue={0} className="input num" /></label>
                  <input name="note" placeholder={ar ? "ملاحظات" : "Notes"} className="input" />
                  <p className="text-xs text-ink-500">{ar ? "السلف القائمة تُخصم تلقائيًا. المكافأة والضريبة يحددها المستشار القانوني/الضريبي." : "Outstanding loans are deducted automatically. Gratuity and tax are set by the legal / tax adviser."}</p>
                  <SubmitButton pendingLabel="…" className="btn-primary w-full">{ar ? "إعداد التسوية" : "Prepare settlement"}</SubmitButton></form>)}
            </div>)}
        </aside>
      </div>
    </>
  );
}
