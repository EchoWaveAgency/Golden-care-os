import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { saveEmployee, applySalaryIncrement } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "./HrTabs";

export const dynamic = "force-dynamic";

type Emp = { id: string; employee_no: string; job_title_ar: string | null; job_title_en: string | null; department: string | null; status: string; hire_date: string;
  payroll_eligible: boolean; biometric_id: string | null; insured_wage: number | null; staff: { full_name_ar: string; full_name_en: string | null; kind: string } | null;
  shift: { name_ar: string; name_en: string | null } | null };

export default async function HrPage({ searchParams }: { searchParams: { error?: string; ok?: string; all?: string } }) {
  const ctx = await requireAny("hr.read", "hr.manage");
  const ar = ctx.locale === "ar";
  let q = ctx.supabase.from("employees").select("id, employee_no, job_title_ar, job_title_en, department, status, hire_date, payroll_eligible, biometric_id, insured_wage, staff:staff(full_name_ar, full_name_en, kind), shift:shifts(name_ar, name_en)")
    .order("employee_no");
  if (!searchParams.all) q = q.neq("status", "terminated");
  const [{ data: emps }, { data: staff }, { data: basics }, { data: shifts }] = await Promise.all([
    q.returns<Emp[]>(),
    ctx.supabase.from("staff").select("id, full_name_ar, full_name_en, kind").eq("is_active", true).order("full_name_ar"),
    ctx.supabase.from("employee_pay_items").select("employee_id, amount, effective").eq("component_code", "BASIC"),
    ctx.supabase.from("shifts").select("id, name_ar, name_en").eq("is_active", true),
  ]);
  const has = new Set((emps ?? []).map((e) => e.staff && e.id));
  const withFile = new Set<string>();
  const { data: links } = await ctx.supabase.from("employees").select("staff_id");
  for (const l of links ?? []) withFile.add(l.staff_id);
  const noFile = (staff ?? []).filter((s) => !withFile.has(s.id));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const basicOf = (id: string) => (basics ?? []).find((b) => b.employee_id === id && String(b.effective).includes(",)"))?.amount;
  const missingData = (emps ?? []).filter((e) => e.payroll_eligible && (!e.biometric_id || e.insured_wage == null || basicOf(e.id) == null));
  void has;

  return (
    <>
      <PageHeader title={ar ? "الموارد البشرية" : "Human resources"} subtitle={ar ? "ملفات الموظفين، الورديات، الحضور والانصراف، والإجازات." : "Employee files, shifts, attendance and leave."}
        actions={<Link href={searchParams.all ? "/os/hr" : "/os/hr?all=1"} className="btn-ghost">{searchParams.all ? (ar ? "الحاليون فقط" : "Current only") : (ar ? "عرض الكل" : "Show all")}</Link>} />
      <HrTabs active="employees" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={searchParams.ok === "saved" ? (ar ? "تم الحفظ." : "Saved.") : searchParams.ok?.startsWith("increment_") ? (ar ? `تم تطبيق الزيادة على ${searchParams.ok.slice(10)} موظف.` : `Increment applied to ${searchParams.ok.slice(10)} employee(s).`) : undefined} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "موظفون حاليون" : "Current employees"} value={(emps ?? []).filter((e) => e.status === "active").length} />
        <Stat label={ar ? "على كشف الرواتب" : "On payroll"} value={(emps ?? []).filter((e) => e.payroll_eligible && e.status === "active").length} tone="teal" />
        <Stat label={ar ? "بيانات ناقصة للرواتب" : "Missing payroll data"} value={missingData.length} tone={missingData.length ? "gold" : "teal"} />
        <Stat label={ar ? "بدون ملف موظف" : "Staff without a file"} value={noFile.length} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm" data-employees>
          <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
            <th className="th">{ar ? "الموظف" : "Employee"}</th><th className="th">{ar ? "الوظيفة" : "Job"}</th><th className="th">{ar ? "الوردية" : "Shift"}</th>
            <th className="th">{ar ? "الأساسي" : "Basic"}</th><th className="th">{ar ? "البصمة" : "Biometric"}</th><th className="th">{ar ? "الحالة" : "Status"}</th></tr></thead>
          <tbody className="divide-y divide-ivory-200">
            {(emps ?? []).length === 0 && <tr><td className="td text-ink-300" colSpan={6}>{ctx.t("common.none")}</td></tr>}
            {(emps ?? []).map((e) => {
              const b = basicOf(e.id);
              return (
                <tr key={e.id}>
                  <td className="td"><Link href={`/os/hr/employees/${e.id}`} className="font-medium text-navy-700 hover:underline">{ar ? e.staff?.full_name_ar : e.staff?.full_name_en ?? e.staff?.full_name_ar}</Link>
                    <span className="block text-xs text-ink-300 num">{e.employee_no}</span></td>
                  <td className="td">{(ar ? e.job_title_ar : e.job_title_en ?? e.job_title_ar) ?? "—"}{e.department ? <span className="block text-xs text-ink-500">{e.department}</span> : null}</td>
                  <td className="td">{e.shift ? (ar ? e.shift.name_ar : e.shift.name_en ?? e.shift.name_ar) : <span className="text-warn">{ar ? "بدون" : "none"}</span>}</td>
                  <td className="td num">{b != null ? money(b, ctx.locale) : <span className="text-warn">—</span>}{!e.payroll_eligible && <span className="block text-xs text-ink-500">{ar ? "خارج الرواتب" : "not on payroll"}</span>}</td>
                  <td className="td num">{e.biometric_id ?? <span className="text-warn">—</span>}</td>
                  <td className="td">{e.status === "active" ? (ar ? "يعمل" : "Active") : e.status === "terminated" ? (ar ? "انتهت خدمته" : "Left") : (ar ? "موقوف" : "Suspended")}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      {ctx.can("hr.manage") && noFile.length > 0 && (
        <form action={saveEmployee} className="card mt-5 flex flex-wrap items-end gap-3 p-4 text-sm" data-new-employee>
          <p className="w-full font-medium text-navy-700">{ar ? "فتح ملف موظف لأحد أفراد الفريق" : "Open an employee file for a staff member"}</p>
          <label><span className="label">{ar ? "الشخص" : "Person"}</span>
            <select name="staff_id" required className="input" id="new_staff">{noFile.map((s) => <option key={s.id} value={s.id}>{ar ? s.full_name_ar : s.full_name_en ?? s.full_name_ar}</option>)}</select></label>
          <label><span className="label">{ar ? "تاريخ التعيين" : "Hire date"}</span><input name="hire_date" type="date" required defaultValue={today} className="input" /></label>
          <label><span className="label">{ar ? "الوظيفة" : "Job title"}</span><input name="job_title_ar" className="input" /></label>
          <label><span className="label">{ar ? "الأجر الأساسي" : "Basic salary"}</span><input name="basic_salary" type="number" min="0" step="0.01" className="input num w-32" /></label>
          <label><span className="label">{ar ? "رقم البصمة" : "Biometric id"}</span><input name="biometric_id" className="input w-28" dir="ltr" /></label>
          <label><span className="label">{ar ? "الوردية" : "Shift"}</span>
            <select name="shift_id" className="input"><option value="">—</option>{(shifts ?? []).map((s) => <option key={s.id} value={s.id}>{ar ? s.name_ar : s.name_en ?? s.name_ar}</option>)}</select></label>
          <SubmitButton pendingLabel="…">{ar ? "فتح الملف" : "Open file"}</SubmitButton>
        </form>)}
      {ctx.can("hr.manage") && (
        <details className="card mt-5 p-4 text-sm" data-increment>
          <summary className="cursor-pointer font-medium text-navy-700">{ar ? "زيادة سنوية لكل الموظفين النشطين" : "Annual increment for all active employees"}</summary>
          <form action={applySalaryIncrement} className="mt-3 flex flex-wrap items-end gap-3">
            <label><span className="label">{ar ? "تبدأ من شهر" : "From month"}</span><input name="month" type="month" required className="input" /></label>
            <label><span className="label">{ar ? "النسبة %" : "Percent"}</span><input name="percent" type="number" min="0.01" max="100" step="0.01" required className="input num w-24" /></label>
            <label><span className="label">{ar ? "البند" : "Component"}</span><select name="component" className="input"><option value="BASIC">{ar ? "الأجر الأساسي" : "Basic salary"}</option>
              <option value="HOUSING">{ar ? "بدل سكن" : "Housing"}</option><option value="TRANSPORT">{ar ? "بدل انتقال" : "Transport"}</option></select></label>
            <input name="note" placeholder={ar ? "ملاحظة (مثال: زيادة 2027)" : "Note (e.g. 2027 increment)"} className="input w-56" />
            <SubmitButton pendingLabel="…" confirm={ar ? "تطبيق الزيادة على كل الموظفين النشطين؟" : "Apply to all active employees?"}>{ar ? "تطبيق" : "Apply"}</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-ink-500">{ar ? "الأجر القديم يظل محفوظًا في السجل، والجديد يسري من أول الشهر المختار. لا يمكن البدء داخل شهر رواتب معتمد." : "The old amount stays in the history; the new one applies from the first of the chosen month. It cannot start inside an approved payroll month."}</p>
        </details>)}
    </>
  );
}
