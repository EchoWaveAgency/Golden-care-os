import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { lastMonth, monthDays, minutesText } from "@/lib/hr";
import { saveReviewCriterion, savePerformanceReview } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../HrTabs";

export const metadata = { title: "Performance" };
export const dynamic = "force-dynamic";

type Kpi = { employee_id: string; name_ar: string; name_en: string; kind: string; days_present: number; days_absent: number; late_minutes: number; overtime_minutes: number;
  appointments_done: number; no_shows: number; cancellations: number; satisfaction: number | null; surveys: number; net_revenue: number; new_patients: number };
type Review = { id: string; ref: string; employee_id: string; period_from: string; period_to: string; scores: Record<string, number>; overall: number | null; status: string;
  strengths: string | null; improvements: string | null; goals: string | null; reviewer_id: string; employee_comment: string | null };

export default async function PerformancePage({ searchParams }: { searchParams: { m?: string; review?: string; ok?: string; error?: string } }) {
  const ctx = await requireAny("performance.review");
  const ar = ctx.locale === "ar";
  const m = /^\d{4}-\d{2}$/.test(searchParams.m ?? "") ? searchParams.m! : lastMonth();
  const days = monthDays(m); const from = days[0], to = days[days.length - 1];
  const [{ data: kpiData, error: kErr }, { data: crit }, { data: revs }] = await Promise.all([
    ctx.supabase.rpc("staff_kpis", { p_branch: ctx.branchId, p_from: from, p_to: to }),
    ctx.supabase.from("review_criteria").select("code, name_ar, name_en, applies_to, weight, is_active").order("sort").order("code"),
    ctx.supabase.from("performance_reviews").select("id, ref, employee_id, period_from, period_to, scores, overall, status, strengths, improvements, goals, reviewer_id, employee_comment")
      .order("created_at", { ascending: false }).limit(50).returns<Review[]>(),
  ]);
  const kpis = (kpiData ?? []) as Kpi[];
  const nameOf = new Map(kpis.map((k) => [k.employee_id, ar ? k.name_ar : k.name_en]));
  const active = (crit ?? []).filter((c) => c.is_active);
  const editing = (revs ?? []).find((r) => r.id === searchParams.review && r.status === "draft" && r.reviewer_id === ctx.user.id);
  const ok = { criterion: ar ? "تم حفظ المعيار." : "Criterion saved.", review_saved: ar ? "تم حفظ المسودة." : "Draft saved.", review_submitted: ar ? "تم إرسال التقييم للموظف." : "Review submitted to the employee." }[searchParams.ok ?? ""];
  const doctors = kpis.some((k) => k.kind === "doctor");
  return (
    <>
      <PageHeader title={ar ? "الأداء ومؤشرات العمل" : "Performance & KPIs"} subtitle={ar ? "المؤشرات محسوبة من سجلات النظام نفسها (الحضور، المواعيد، التقييمات، الإيراد). معايير التقييم وأوزانها تحددها الإدارة." : "KPIs come from the system's own records (attendance, appointments, ratings, revenue). Review criteria and weights are set by management."} />
      <HrTabs active="performance" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error ?? kErr?.message} success={ok} />
      <form className="mb-4 flex items-center gap-2 text-sm"><label>{ar ? "الشهر" : "Month"} <input name="m" type="month" defaultValue={m} className="input inline w-auto" /></label><button className="btn-ghost">{ctx.t("common.search")}</button></form>
      <div className="card mb-6 overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm" data-kpis>
          <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
            <th className="th">{ar ? "الموظف" : "Employee"}</th><th className="th">{ar ? "حضور" : "Present"}</th><th className="th">{ar ? "غياب" : "Absent"}</th><th className="th">{ar ? "تأخير" : "Late"}</th><th className="th">{ar ? "إضافي" : "Overtime"}</th>
            {doctors && <><th className="th">{ar ? "زيارات" : "Visits"}</th><th className="th">{ar ? "لم يحضر" : "No-show"}</th><th className="th">{ar ? "تقييم المرضى" : "Rating"}</th><th className="th">{ar ? "مرضى جدد" : "New patients"}</th><th className="th">{ar ? "الإيراد" : "Revenue"}</th></>}
          </tr></thead>
          <tbody className="divide-y divide-ivory-200">
            {kpis.map((k) => (
              <tr key={k.employee_id}>
                <td className="td font-medium">{ar ? k.name_ar : k.name_en}</td>
                <td className="td num">{k.days_present}</td><td className={`td num ${k.days_absent ? "text-danger" : ""}`}>{k.days_absent}</td>
                <td className="td">{minutesText(k.late_minutes, ar)}</td><td className="td">{minutesText(k.overtime_minutes, ar)}</td>
                {doctors && <>{k.kind === "doctor" ? <>
                  <td className="td num">{k.appointments_done}</td>
                  <td className="td num">{k.appointments_done + k.no_shows > 0 ? `${Math.round((k.no_shows * 100) / (k.appointments_done + k.no_shows))}%` : "—"}</td>
                  <td className="td num">{k.satisfaction != null ? `${Number(k.satisfaction).toFixed(1)} / 5 (${k.surveys})` : "—"}</td>
                  <td className="td num">{k.new_patients}</td><td className="td num">{money(k.net_revenue, ctx.locale)}</td></> : <td className="td text-ink-300" colSpan={5}>—</td>}</>}
              </tr>))}
            {kpis.length === 0 && <tr><td className="td text-ink-300" colSpan={10}>{ctx.t("common.none")}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <form action={savePerformanceReview} className="card space-y-3 p-5 text-sm lg:col-span-2" data-review-form key={editing?.id ?? "new"}>
          <h2 className="font-medium text-navy-700">{editing ? (ar ? `تعديل المسودة ${editing.ref}` : `Edit draft ${editing.ref}`) : (ar ? "تقييم جديد" : "New review")}</h2>
          <input type="hidden" name="m" value={m} />{editing && <input type="hidden" name="id" value={editing.id} />}
          {active.length === 0 ? <p className="text-warn">{ar ? "أضف معايير التقييم أولًا (من القائمة الجانبية)." : "Add the review criteria first (side panel)."}</p> : <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label><span className="label">{ar ? "الموظف" : "Employee"}</span>
                <select name="employee_id" defaultValue={editing?.employee_id} className="input">{kpis.map((k) => <option key={k.employee_id} value={k.employee_id}>{ar ? k.name_ar : k.name_en}</option>)}</select></label>
              <label><span className="label">{ar ? "من" : "From"}</span><input name="period_from" type="date" required defaultValue={editing?.period_from ?? from} className="input" /></label>
              <label><span className="label">{ar ? "إلى" : "To"}</span><input name="period_to" type="date" required defaultValue={editing?.period_to ?? to} className="input" /></label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {active.map((c) => (
                <label key={c.code} className="flex items-center justify-between gap-2 rounded-lg bg-ivory-50 px-3 py-2"><span>{ar ? c.name_ar : c.name_en} <span className="text-xs text-ink-500">×{Number(c.weight)}</span></span>
                  <select name={`score_${c.code}`} defaultValue={editing?.scores?.[c.code] ?? ""} className="input w-20 py-1"><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>))}
            </div>
            <label className="block"><span className="label">{ar ? "نقاط القوة" : "Strengths"}</span><textarea name="strengths" rows={2} defaultValue={editing?.strengths ?? ""} className="input" /></label>
            <label className="block"><span className="label">{ar ? "مجالات التحسين" : "To improve"}</span><textarea name="improvements" rows={2} defaultValue={editing?.improvements ?? ""} className="input" /></label>
            <label className="block"><span className="label">{ar ? "أهداف الفترة القادمة" : "Goals for next period"}</span><textarea name="goals" rows={2} defaultValue={editing?.goals ?? ""} className="input" /></label>
            <div className="flex gap-2"><SubmitButton name="submit" value="0" pendingLabel="…" className="btn-ghost">{ar ? "حفظ كمسودة" : "Save draft"}</SubmitButton>
              <SubmitButton name="submit" value="1" pendingLabel="…" confirm={ar ? "بعد الإرسال لا يمكن التعديل. متأكد؟" : "A submitted review cannot be changed. Continue?"}>{ar ? "إرسال للموظف" : "Submit to employee"}</SubmitButton></div>
          </>}
        </form>
        <aside className="space-y-4">
          <div className="card p-4 text-sm" data-reviews>
            <h2 className="mb-2 font-medium text-navy-700">{ar ? "التقييمات" : "Reviews"}</h2>
            <ul className="space-y-2">{(revs ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-1">
                <span>{nameOf.get(r.employee_id) ?? r.ref} · <span className="num text-xs">{r.period_from.slice(0, 7)}</span></span>
                <span className="text-xs">{r.overall != null ? <span className="num font-medium">{Number(r.overall).toFixed(2)}</span> : null} · {r.status === "draft" ? (r.reviewer_id === ctx.user.id ? <a className="text-teal-700 hover:underline" href={`?m=${m}&review=${r.id}`}>{ar ? "مسودة — تعديل" : "draft — edit"}</a> : (ar ? "مسودة" : "draft")) : r.status === "submitted" ? (ar ? "أُرسل" : "submitted") : (ar ? "اطلع عليه الموظف" : "acknowledged")}</span>
                {r.employee_comment && <span className="w-full text-xs text-ink-500">«{r.employee_comment}»</span>}
              </li>))}
              {(revs ?? []).length === 0 && <li className="text-ink-300">{ctx.t("common.none")}</li>}</ul>
          </div>
          <details className="card p-4 text-sm" data-criteria open={active.length === 0}>
            <summary className="cursor-pointer font-medium text-navy-700">{ar ? "معايير التقييم" : "Review criteria"}</summary>
            <ul className="mt-2 space-y-1 text-xs">{(crit ?? []).map((c) => <li key={c.code} className={c.is_active ? "" : "text-ink-300"}><span className="num">{c.code}</span> · {ar ? c.name_ar : c.name_en} · ×{Number(c.weight)}</li>)}</ul>
            <form key={`crit-${(crit ?? []).length}`} action={saveReviewCriterion} className="mt-3 space-y-2"><input type="hidden" name="m" value={m} />
              <input name="code" required pattern="[A-Za-z][A-Za-z0-9_]{1,23}" placeholder={ar ? "الكود (مثال CARE)" : "Code (e.g. CARE)"} className="input" dir="ltr" />
              <input name="name_ar" required placeholder={ar ? "الاسم بالعربي" : "Arabic name"} className="input" />
              <input name="name_en" placeholder={ar ? "الاسم بالإنجليزي" : "English name"} className="input" dir="ltr" />
              <input name="weight" type="number" min="0.1" step="0.1" defaultValue={1} className="input num" aria-label={ar ? "الوزن" : "Weight"} />
              <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "حفظ المعيار" : "Save criterion"}</SubmitButton></form>
          </details>
        </aside>
      </div>
    </>
  );
}
