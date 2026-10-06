import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { ATT_STATUS, lab, minutesText, monthDays } from "@/lib/hr";
import { addManualPunch, approveOvertime, decideManualPunch, importAttendance, recomputeAttendance, saveDevice } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../HrTabs";

export const dynamic = "force-dynamic";

type Day = { employee_id: string; day: string; status: string; late_minutes: number; overtime_minutes: number; overtime_approved_minutes: number; first_in: string | null; last_out: string | null };

export default async function AttendancePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const ctx = await requireAny("hr.read", "attendance.manage");
  const ar = ctx.locale === "ar";
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
  const days = monthDays(month);
  const [{ data: emps }, { data: att }, { data: pending }, { data: unmatched }, { data: devices }] = await Promise.all([
    ctx.supabase.from("employees").select("id, employee_no, biometric_id, staff:staff(full_name_ar, full_name_en)").neq("status", "terminated").order("employee_no")
      .returns<{ id: string; employee_no: string; biometric_id: string | null; staff: { full_name_ar: string; full_name_en: string | null } | null }[]>(),
    ctx.supabase.from("attendance_days").select("employee_id, day, status, late_minutes, overtime_minutes, overtime_approved_minutes, first_in, last_out")
      .gte("day", days[0]).lte("day", days[days.length - 1]).returns<Day[]>(),
    ctx.supabase.from("attendance_punches").select("id, employee_id, punched_at, reason").eq("status", "pending").order("punched_at"),
    ctx.supabase.from("attendance_punches").select("biometric_id").is("employee_id", null).gte("punched_at", `${days[0]}T00:00:00+03:00`),
    ctx.supabase.from("attendance_devices").select("id, serial_no, name, is_active, last_seen_at").order("name"),
  ]);
  const name = new Map((emps ?? []).map((e) => [e.id, (ar ? e.staff?.full_name_ar : e.staff?.full_name_en ?? e.staff?.full_name_ar) ?? e.employee_no]));
  const cell = new Map((att ?? []).map((a) => [`${a.employee_id}|${a.day}`, a]));
  const ot = (att ?? []).filter((a) => a.overtime_minutes > a.overtime_approved_minutes && a.overtime_minutes >= 15);
  const manage = ctx.can("attendance.manage"), approve = ctx.can("attendance.approve");
  const ids = Array.from(new Set((unmatched ?? []).map((u) => u.biometric_id)));
  const ok = searchParams.ok === "imported"
    ? (ar ? `تم الاستيراد: ${searchParams.imported} بصمة جديدة، ${searchParams.dup} مكررة، ${searchParams.unmatched} برقم غير مربوط، ${searchParams.rejected} سطر غير صالح.`
          : `Imported: ${searchParams.imported} new, ${searchParams.dup} duplicates, ${searchParams.unmatched} unknown ids, ${searchParams.rejected} invalid lines.`)
    : { punch_added: ar ? "تم تسجيل البصمة اليدوية وتنتظر اعتماد مسؤول آخر." : "Manual punch recorded; another manager must approve it.", decided: ar ? "تم." : "Done.",
        overtime: ar ? "تم اعتماد الإضافي." : "Overtime approved.", device: ar ? "تم حفظ الجهاز." : "Device saved.", recomputed: ar ? "تمت إعادة الحساب." : "Recomputed.", roster: ar ? "تم تعديل الجدول." : "Roster updated." }[searchParams.ok ?? ""];
  const prev = (() => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  const next = (() => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();

  return (
    <>
      <PageHeader title={ar ? "الحضور والانصراف" : "Attendance"} subtitle={ar ? "من ملف جهاز البصمة أو الإرسال المباشر من الجهاز. التأخير يُحسب بعد فترة السماح في الوردية." : "From the biometric export file or the device push. Lateness counts after the shift's grace period."}
        actions={<div className="flex items-center gap-2 text-sm"><a href={`?month=${prev}`} className="btn-ghost">‹</a><span className="num font-medium">{month}</span><a href={`?month=${next}`} className="btn-ghost">›</a></div>} />
      <HrTabs active="attendance" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={ok} />

      {manage && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <form action={importAttendance} className="card space-y-2 p-4 text-sm" data-import>
            <p className="font-medium text-navy-700">{ar ? "استيراد ملف البصمة" : "Import the biometric file"}</p>
            <p className="text-xs text-ink-500">{ar ? "CSV أو TXT من الجهاز (رقم الموظف + التاريخ والوقت). التكرار يُتجاهل تلقائيًا." : "CSV or TXT export (employee id + date and time). Duplicates are ignored."}</p>
            <input type="file" name="file" accept=".csv,.txt,.dat,.tsv" className="block text-xs" />
            <textarea name="text" rows={3} placeholder={ar ? "أو الصق السطور هنا" : "or paste the lines here"} className="input font-mono text-xs" dir="ltr" data-import-text />
            <SubmitButton pendingLabel="…">{ar ? "استيراد" : "Import"}</SubmitButton>
          </form>
          <form action={addManualPunch} className="card space-y-2 p-4 text-sm">
            <p className="font-medium text-navy-700">{ar ? "بصمة يدوية (نسيان / عطل)" : "Manual punch (forgotten / device fault)"}</p>
            <select name="employee_id" required className="input">{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{name.get(e.id)}</option>)}</select>
            <div className="flex gap-2"><input name="day" type="date" required className="input" /><input name="time" type="time" required className="input" /></div>
            <input name="reason" required placeholder={ar ? "السبب (مطلوب)" : "Reason (required)"} className="input" />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "تسجيل للاعتماد" : "Submit for approval"}</SubmitButton>
          </form>
        </div>)}

      {ids.length > 0 && <p className="mb-4 rounded-xl border border-gold-300 bg-gold-50 px-4 py-2 text-sm">{ar ? "أرقام بصمة غير مربوطة بموظف: " : "Biometric ids not linked to an employee: "}<span className="num" dir="ltr">{ids.join(", ")}</span>{ar ? " — أضفها في ملف الموظف ثم أعد الحساب." : " — add them to the employee file, then recompute."}</p>}

      {(pending ?? []).length > 0 && (
        <section className="mb-5"><h2 className="mb-2 font-medium text-navy-700">{ar ? "بصمات يدوية بانتظار الاعتماد" : "Manual punches awaiting approval"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">{(pending ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" data-pending-punch>
              <span>{name.get(p.employee_id!)} · {dateTime(p.punched_at, ctx.locale)} · <span className="text-ink-500">{p.reason}</span></span>
              {approve && <form action={decideManualPunch} className="flex gap-2"><input type="hidden" name="id" value={p.id} />
                <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "رفض" : "Reject"}</SubmitButton></form>}
            </li>))}</ul></section>)}

      <div className="card overflow-x-auto" data-att-grid>
        <table className="text-xs">
          <thead className="bg-ivory-50"><tr><th className="th sticky start-0 bg-ivory-50">{ar ? "الموظف" : "Employee"}</th>
            {days.map((d) => <th key={d} className="px-1 py-2 text-center font-normal text-ink-500 num">{d.slice(8)}</th>)}
            <th className="th">{ar ? "غياب" : "Abs."}</th><th className="th">{ar ? "تأخير" : "Late"}</th></tr></thead>
          <tbody className="divide-y divide-ivory-200">
            {(emps ?? []).map((e) => {
              const row = days.map((d) => cell.get(`${e.id}|${d}`));
              return (
                <tr key={e.id}>
                  <td className="td sticky start-0 whitespace-nowrap bg-white">{name.get(e.id)}</td>
                  {row.map((a, i) => <td key={days[i]} className="px-0.5 py-1 text-center">{a ? (
                    <span title={`${days[i]} · ${lab(ATT_STATUS, a.status, ar)}${a.first_in ? ` · ${dateTime(a.first_in, ctx.locale, { dateStyle: undefined })}` : ""}${a.last_out ? `–${dateTime(a.last_out, ctx.locale, { dateStyle: undefined })}` : ""}${a.late_minutes ? ` · +${a.late_minutes}` : ""}`}
                      className={`inline-grid h-6 w-6 place-items-center rounded ${ATT_STATUS[a.status]?.tone}`}>{ATT_STATUS[a.status]?.short}</span>) : <span className="text-ink-200">·</span>}</td>)}
                  <td className="td num">{row.filter((a) => a?.status === "absent").length}</td>
                  <td className="td num whitespace-nowrap">{minutesText(row.reduce((x, a) => x + (a?.late_minutes ?? 0), 0), ar)}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-ink-500">{Object.entries(ATT_STATUS).map(([k, v]) => <span key={k}><span className={`inline-grid h-5 w-5 place-items-center rounded ${v.tone}`}>{v.short}</span> {ar ? v.ar : v.en}</span>)}</p>

      {ot.length > 0 && (
        <section className="mt-6"><h2 className="mb-2 font-medium text-navy-700">{ar ? "ساعات إضافية تحتاج اعتماد" : "Overtime to approve"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">{ot.map((a) => (
            <li key={`${a.employee_id}${a.day}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2" data-overtime>
              <span>{name.get(a.employee_id)} · <span className="num">{a.day}</span> · {minutesText(a.overtime_minutes, ar)}</span>
              {approve && <form action={approveOvertime} className="flex items-center gap-2"><input type="hidden" name="employee_id" value={a.employee_id} /><input type="hidden" name="day" value={a.day} />
                <input type="hidden" name="back" value={`/os/hr/attendance?month=${month}`} />
                <input name="minutes" type="number" min="0" max={a.overtime_minutes} defaultValue={a.overtime_minutes} className="input num w-20 py-1 text-xs" />
                <SubmitButton pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "اعتماد" : "Approve"}</SubmitButton></form>}
            </li>))}</ul></section>)}

      {ctx.can("hr.manage") && (
        <section className="mt-6"><h2 className="mb-2 font-medium text-navy-700">{ar ? "أجهزة البصمة (إرسال مباشر)" : "Biometric devices (direct push)"}</h2>
          <div className="card space-y-3 p-4 text-sm">
            <p className="text-xs text-ink-500">{ar ? "في إعدادات الجهاز (Cloud Server / ADMS): عنوان السيرفر = عنوان النظام، والمسار /iclock/cdata. يُقبل فقط الجهاز المسجل هنا برقمه التسلسلي."
              : "In the device settings (Cloud Server / ADMS): server = this system's address, path /iclock/cdata. Only devices registered here by serial number are accepted."}</p>
            <ul className="space-y-1">{(devices ?? []).map((d) => <li key={d.id} className="flex justify-between"><span>{d.name} <span className="num text-xs text-ink-500" dir="ltr">{d.serial_no}</span></span>
              <span className="text-xs text-ink-500">{d.is_active ? (d.last_seen_at ? `${ar ? "آخر اتصال" : "last seen"} ${dateTime(d.last_seen_at, ctx.locale)}` : (ar ? "لم يتصل بعد" : "not seen yet")) : (ar ? "موقوف" : "disabled")}</span></li>)}</ul>
            <form action={saveDevice} className="flex flex-wrap items-end gap-2">
              <input name="serial_no" required placeholder={ar ? "الرقم التسلسلي" : "Serial number"} className="input w-44" dir="ltr" />
              <input name="name" required placeholder={ar ? "الاسم (مثل: بوابة الاستقبال)" : "Name (e.g. reception gate)"} className="input w-56" />
              <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "تسجيل جهاز" : "Register device"}</SubmitButton></form>
          </div></section>)}

      {manage && (
        <form action={recomputeAttendance} className="mt-6 flex flex-wrap items-end gap-2 text-sm"><input type="hidden" name="from" value={days[0]} /><input type="hidden" name="to" value={days[days.length - 1]} />
          <input type="hidden" name="back" value={`/os/hr/attendance?month=${month}`} />
          <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إعادة حساب الشهر (بعد تعديل وردية أو رقم بصمة)" : "Recompute the month (after changing a shift or biometric id)"}</SubmitButton></form>)}
    </>
  );
}
