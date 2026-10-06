import { requireAny } from "@/lib/session";
import { saveBrackets, saveComponent, saveSetting } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const NEEDS_RATE = new Set(["insurance_employee", "insurance_employer", "attendance_overtime", "attendance_late"]);

export default async function PayrollSettingsPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("payroll.settings");
  const ar = ctx.locale === "ar";
  const [{ data: comps }, { data: settings }, { data: brackets }] = await Promise.all([
    ctx.supabase.from("payroll_components").select("*").order("sort"),
    ctx.supabase.from("payroll_settings").select("*").order("key"),
    ctx.supabase.from("payroll_tax_brackets").select("*").order("effective_from", { ascending: false }).order("from_amount"),
  ]);
  const latest = (brackets ?? []).length ? (brackets ?? [])[0].effective_from : null;
  const current = (brackets ?? []).filter((b) => b.effective_from === latest);
  const rows = Array.from({ length: Math.max(current.length + 1, 5) }, (_, i) => current[i]);
  const rateHint: Record<string, { ar: string; en: string }> = {
    insurance_employee: { ar: "% من الأجر التأميني", en: "% of the insured wage" }, insurance_employer: { ar: "% من الأجر التأميني", en: "% of the insured wage" },
    attendance_overtime: { ar: "مضاعف أجر الدقيقة (مثل 1.35)", en: "× minute rate (e.g. 1.35)" }, attendance_late: { ar: "مضاعف أجر الدقيقة (1 = خصم الوقت فقط)", en: "× minute rate (1 = deduct the time only)" },
  };
  const label: Record<string, { ar: string; en: string }> = {
    day_divisor: { ar: "قاسم الأجر اليومي", en: "Daily rate divisor" }, hours_per_day: { ar: "ساعات اليوم", en: "Hours per day" },
    insured_wage_min: { ar: "الحد الأدنى للأجر التأميني", en: "Minimum insured wage" }, insured_wage_max: { ar: "الحد الأقصى للأجر التأميني", en: "Maximum insured wage" },
    tax_personal_exemption: { ar: "الإعفاء الشخصي السنوي", en: "Annual personal exemption" },
  };
  return (
    <>
      <PageHeader title={ar ? "إعدادات الرواتب" : "Payroll settings"} subtitle={ar ? "النسب والشرائح يحددها رئيس الحسابات حسب القانون الساري. الكشف لا يُعد قبل اكتمالها، أو أوقف البند غير المطبق." : "Rates and brackets are set by the chief accountant under the law in force. Payroll will not run until they are complete, or switch a component off."} />
      <Banner error={searchParams.error} success={searchParams.ok === "saved" ? (ar ? "تم الحفظ." : "Saved.") : undefined} />
      <section className="mb-6">
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "بنود الراتب" : "Pay components"}</h2>
        <ul className="card divide-y divide-ivory-200 text-sm" data-components>
          {(comps ?? []).map((c) => (
            <li key={c.code}>
              <form action={saveComponent} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2" data-component={c.code}>
                <input type="hidden" name="code" value={c.code} />
                <span className="min-w-56"><span className="font-medium">{ar ? c.name_ar : c.name_en}</span> <span className="num text-xs text-ink-300">{c.code}</span>
                  <span className="block text-xs text-ink-500">{c.kind === "earning" ? (ar ? "استحقاق" : "Earning") : c.kind === "deduction" ? (ar ? "خصم" : "Deduction") : (ar ? "على صاحب العمل" : "Employer")}
                    {NEEDS_RATE.has(c.calc) && c.is_active && c.rate == null ? <span className="text-danger"> · {ar ? "النسبة غير محددة" : "rate not set"}</span> : null}</span></span>
                <span className="flex items-center gap-3">
                  {NEEDS_RATE.has(c.calc) && <label className="flex items-center gap-2"><input name="rate" type="number" min="0" step="0.0001" defaultValue={c.rate ?? ""} className="input num w-28 py-1" />
                    <span className="text-xs text-ink-500">{ar ? rateHint[c.calc].ar : rateHint[c.calc].en}</span></label>}
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={c.is_active} disabled={c.code === "BASIC"} />{ar ? "مفعّل" : "Active"}</label>
                  {c.code !== "BASIC" && <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "حفظ" : "Save"}</SubmitButton>}
                </span>
              </form>
            </li>))}
        </ul>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "قيم عامة" : "General values"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">
            {(settings ?? []).map((s) => (
              <li key={s.key}><form action={saveSetting} className="flex items-center justify-between gap-3 px-4 py-2" data-setting={s.key}>
                <input type="hidden" name="key" value={s.key} /><span>{ar ? label[s.key]?.ar : label[s.key]?.en}</span>
                <span className="flex gap-2"><input name="value" type="number" min="0" step="0.01" defaultValue={s.value ?? ""} className="input num w-32 py-1" />
                  <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "حفظ" : "Save"}</SubmitButton></span></form></li>))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "شرائح ضريبة كسب العمل (سنوي)" : "Payroll tax brackets (annual)"}</h2>
          <form action={saveBrackets} className="card space-y-2 p-4 text-sm" data-brackets>
            <label className="flex items-center gap-2"><span>{ar ? "تسري من" : "Effective from"}</span><input name="effective" type="date" required defaultValue={latest ?? ""} className="input w-44" /></label>
            <div className="grid grid-cols-3 gap-2 text-xs text-ink-500"><span>{ar ? "من" : "From"}</span><span>{ar ? "إلى (فارغ = بلا حد)" : "To (blank = no limit)"}</span><span>%</span></div>
            {rows.map((b, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <input name={`from_${i}`} type="number" min="0" step="0.01" defaultValue={b?.from_amount ?? ""} className="input num py-1" />
                <input name={`to_${i}`} type="number" min="0" step="0.01" defaultValue={b?.to_amount ?? ""} className="input num py-1" />
                <input name={`rate_${i}`} type="number" min="0" max="100" step="0.001" defaultValue={b?.rate ?? ""} className="input num py-1" />
              </div>))}
            <SubmitButton pendingLabel="…">{ar ? "حفظ الشرائح" : "Save brackets"}</SubmitButton>
          </form>
        </section>
      </div>
    </>
  );
}
