import Link from "next/link";
import { getContext } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { ATT_STATUS, LEAVE_STATUS, lab, minutesText } from "@/lib/hr";
import { cancelLeave, requestLeave } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// Every staff member with an employee file: own attendance, leave and payslips (RLS returns only their rows).
export default async function MePage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await getContext();
  const ar = ctx.locale === "ar";
  const { data: emp } = ctx.staff
    ? await ctx.supabase.from("employees").select("id, employee_no, job_title_ar, job_title_en, hire_date, shift:shifts(name_ar, name_en, start_time, end_time)").eq("staff_id", ctx.staff.id).maybeSingle()
    : { data: null };
  if (!emp) {
    return (<><PageHeader title={ar ? "بياناتي" : "My file"} /><p className="card p-5 text-sm text-ink-500">{ar ? "لا يوجد ملف موظف مرتبط بحسابك. تواصل مع الموارد البشرية." : "No employee file is linked to your account. Please contact HR."}</p></>);
  }
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
  const [{ data: att }, { data: bal }, { data: leaves }, { data: slips }, { data: types }] = await Promise.all([
    ctx.supabase.from("attendance_days").select("day, status, first_in, last_out, late_minutes").eq("employee_id", emp.id).gte("day", `${month}-01`).order("day", { ascending: false }),
    ctx.supabase.rpc("my_leave_balances"),
    ctx.supabase.from("leave_requests").select("id, ref, leave_type, from_date, to_date, days, status, decision_note").eq("employee_id", emp.id).order("from_date", { ascending: false }).limit(12),
    ctx.supabase.from("payroll_slips").select("run_id, net, run:payroll_runs(period, status)").eq("employee_id", emp.id),
    ctx.supabase.from("leave_types").select("code, name_ar, name_en").eq("is_active", true),
  ]);
  const shift = emp.shift as unknown as { name_ar: string; name_en: string | null; start_time: string; end_time: string } | null;
  const ok = { leave_requested: ar ? "تم إرسال طلب الإجازة للاعتماد." : "Leave request sent for approval.", leave_cancelled: ar ? "تم إلغاء الطلب." : "Request cancelled." }[searchParams.ok ?? ""];
  const mySlips = ((slips ?? []) as unknown as { run_id: string; net: number; run: { period: string; status: string } | null }[]).sort((a, b) => (b.run?.period ?? "").localeCompare(a.run?.period ?? ""));
  return (
    <>
      <PageHeader title={ar ? "بياناتي" : "My file"} subtitle={`${emp.employee_no} · ${(ar ? emp.job_title_ar : emp.job_title_en ?? emp.job_title_ar) ?? ""}${shift ? ` · ${ar ? shift.name_ar : shift.name_en ?? shift.name_ar} ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}` : ""}`} />
      <Banner error={searchParams.error} success={ok} />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card p-4 text-sm" data-my-attendance>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "حضوري هذا الشهر" : "My attendance this month"}</h2>
          <ul className="space-y-1">{(att ?? []).map((a) => (
            <li key={a.day} className="flex justify-between gap-2"><span className="num">{a.day}</span>
              <span className={`rounded px-2 text-xs ${ATT_STATUS[a.status]?.tone}`}>{lab(ATT_STATUS, a.status, ar)}{a.late_minutes ? ` +${minutesText(a.late_minutes, ar)}` : ""}</span>
              <span className="text-xs text-ink-500">{a.first_in ? dateTime(a.first_in, ctx.locale, { dateStyle: undefined }) : ""}{a.last_out ? ` – ${dateTime(a.last_out, ctx.locale, { dateStyle: undefined })}` : ""}</span></li>))}
            {(att ?? []).length === 0 && <li className="text-ink-300">{ctx.t("common.none")}</li>}</ul>
        </section>
        <section className="card space-y-3 p-4 text-sm" data-my-leave>
          <h2 className="font-medium text-navy-700">{ar ? "إجازاتي" : "My leave"}</h2>
          <ul className="space-y-1">{((bal ?? []) as { leave_type: string; name_ar: string; name_en: string; entitled: number | null; used: number; remaining: number | null }[]).map((b) => (
            <li key={b.leave_type} className="flex justify-between"><span>{ar ? b.name_ar : b.name_en}</span>
              <span className="num">{b.entitled == null ? `${b.used}` : `${b.remaining} / ${b.entitled}`}</span></li>))}</ul>
          <form action={requestLeave} className="space-y-2 border-t border-ivory-200 pt-3"><input type="hidden" name="back" value="/os/me" />
            <select name="leave_type" className="input">{(types ?? []).map((t) => <option key={t.code} value={t.code}>{ar ? t.name_ar : t.name_en}</option>)}</select>
            <div className="flex gap-2"><input name="from" type="date" required className="input" /><input name="to" type="date" required className="input" /></div>
            <input name="reason" placeholder={ar ? "السبب" : "Reason"} className="input" />
            <SubmitButton pendingLabel="…">{ar ? "طلب إجازة" : "Request leave"}</SubmitButton>
          </form>
          <ul className="space-y-1 text-xs">{(leaves ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2"><span><span className="num">{l.from_date} → {l.to_date}</span> · {l.days} · {lab(LEAVE_STATUS, l.status, ar)}{l.decision_note ? ` · ${l.decision_note}` : ""}</span>
              {l.status === "requested" && <form action={cancelLeave}><input type="hidden" name="id" value={l.id} /><SubmitButton pendingLabel="…" className="text-danger">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>}</li>))}</ul>
        </section>
        <section className="card p-4 text-sm" data-my-payslips>
          <h2 className="mb-2 font-medium text-navy-700">{ar ? "قسائم الراتب" : "Payslips"}</h2>
          <ul className="space-y-1">{mySlips.map((s) => (
            <li key={s.run_id} className="flex justify-between"><Link href={`/os/payslip/${s.run_id}/${emp.id}`} className="num text-teal-700 hover:underline">{s.run?.period.slice(0, 7)}</Link>
              <span className="num">{money(s.net, ctx.locale)}</span></li>))}
            {mySlips.length === 0 && <li className="text-ink-300">{ctx.t("common.none")}</li>}</ul>
        </section>
      </div>
    </>
  );
}
