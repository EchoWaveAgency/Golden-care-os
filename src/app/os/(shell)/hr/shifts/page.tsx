import { requireAny } from "@/lib/session";
import { WEEKDAYS } from "@/lib/hr";
import { saveShift } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../HrTabs";

export const dynamic = "force-dynamic";

type S = { id: string; code: string; name_ar: string; name_en: string | null; start_time: string; end_time: string; break_minutes: number; grace_minutes: number; weekdays: number[]; is_active: boolean };

export default async function ShiftsPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("hr.read", "hr.manage");
  const ar = ctx.locale === "ar";
  const { data } = await ctx.supabase.from("shifts").select("*").order("code").returns<S[]>();
  const manage = ctx.can("hr.manage");
  const form = (s?: S) => (
    <form action={saveShift} className="grid gap-3 text-sm md:grid-cols-6" key={s?.id ?? "new"}>
      {s && <input type="hidden" name="id" value={s.id} />}
      <label><span className="label">{ar ? "الكود" : "Code"}</span><input name="code" required defaultValue={s?.code} readOnly={!!s} className="input" dir="ltr" /></label>
      <label className="md:col-span-2"><span className="label">{ar ? "الاسم" : "Name"}</span><input name="name_ar" required defaultValue={s?.name_ar} className="input" /></label>
      <label><span className="label">{ar ? "من" : "From"}</span><input name="start_time" type="time" required defaultValue={s?.start_time.slice(0, 5)} className="input" /></label>
      <label><span className="label">{ar ? "إلى" : "To"}</span><input name="end_time" type="time" required defaultValue={s?.end_time.slice(0, 5)} className="input" /></label>
      <label><span className="label">{ar ? "سماح التأخير (د)" : "Grace (min)"}</span><input name="grace_minutes" type="number" min="0" max="120" defaultValue={s?.grace_minutes ?? 10} className="input num" /></label>
      <label><span className="label">{ar ? "الراحة (د)" : "Break (min)"}</span><input name="break_minutes" type="number" min="0" max="240" defaultValue={s?.break_minutes ?? 30} className="input num" /></label>
      <fieldset className="flex flex-wrap items-center gap-3 md:col-span-4"><legend className="label">{ar ? "أيام العمل" : "Working days"}</legend>
        {WEEKDAYS.map((d) => <label key={d.n} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={d.n} defaultChecked={s ? s.weekdays.includes(d.n) : d.n !== 5} />{ar ? d.ar : d.en}</label>)}</fieldset>
      {manage && <div className="flex items-end"><SubmitButton pendingLabel="…">{s ? (ar ? "حفظ" : "Save") : (ar ? "إضافة وردية" : "Add shift")}</SubmitButton></div>}
    </form>);
  return (
    <>
      <PageHeader title={ar ? "الورديات" : "Shifts"} subtitle={ar ? "الوردية اللي تنتهي بعد منتصف الليل: اكتب وقت النهاية أصغر من البداية." : "For a shift that ends after midnight, set an end time earlier than the start."} />
      <HrTabs active="shifts" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={searchParams.ok === "saved" ? (ar ? "تم الحفظ." : "Saved.") : undefined} />
      <div className="space-y-3">
        {(data ?? []).map((s) => <div key={s.id} className="card p-4">{form(s)}</div>)}
        {manage && <div className="card border-dashed p-4" data-new-shift>{form()}</div>}
      </div>
    </>
  );
}
