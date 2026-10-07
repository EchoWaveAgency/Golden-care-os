import { requireAny } from "@/lib/session";
import { clinicToday, clinicLocalToIso, timeOnly, rangeStart, dateTime } from "@/lib/format";
import { patientName } from "@/lib/types";
import { PrintButton } from "@/components/PrintButton";
import type { DictKey } from "@/lib/i18n";

export const metadata = { title: "Day sheet" };
export const dynamic = "force-dynamic";

type Apt = {
  id: string; slot: string; status: string; queue_no: number | null; doctor_id: string; notes_admin: string | null;
  patient: { mrn: string; first_name_ar: string; last_name_ar: string; phone: string } | null;
  doctor: { full_name_ar: string; full_name_en: string | null } | null;
  type: { name_ar: string; name_en: string } | null;
};

// Printed list of the day's appointments, one page per doctor — the paper fallback when the network is down,
// and the doctor's door list. Cancelled and no-show bookings are left out unless asked for.
export default async function DaySheet({ searchParams }: { searchParams: { day?: string; doctor?: string; all?: string } }) {
  const ctx = await requireAny("appointment.read", "appointment.write");
  const ar = ctx.locale === "ar";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? "") ? searchParams.day! : clinicToday();
  const from = clinicLocalToIso(day, "00:00");
  const to = new Date(new Date(from).getTime() + 24 * 3600_000).toISOString();
  let q = ctx.supabase.from("appointments")
    .select("id, slot, status, queue_no, doctor_id, notes_admin, patient:patients(mrn, first_name_ar, last_name_ar, phone), doctor:staff(full_name_ar, full_name_en), type:appointment_types(name_ar, name_en)")
    .eq("branch_id", ctx.branchId!).overlaps("slot", `[${from},${to})`).order("slot");
  if (searchParams.doctor) q = q.eq("doctor_id", searchParams.doctor);
  if (!searchParams.all) q = q.not("status", "in", "(canceled,no_show)");
  const { data } = await q.returns<Apt[]>();
  const { data: branch } = await ctx.supabase.from("branches").select("name_ar, name_en").eq("id", ctx.branchId!).maybeSingle();
  const groups = new Map<string, Apt[]>();
  for (const a of data ?? []) groups.set(a.doctor_id, [...(groups.get(a.doctor_id) ?? []), a]);
  const doctors = Array.from(groups.values()).sort((x, y) => (x[0].doctor?.full_name_ar ?? "").localeCompare(y[0].doctor?.full_name_ar ?? "", "ar"));
  const printedAt = dateTime(new Date(), ctx.locale);

  return (
    <div className="min-h-screen bg-ivory-100 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: A4; margin: 12mm; } .sheet { break-after: page; box-shadow: none; } .sheet:last-child { break-after: auto; } }`}</style>
      <form className="no-print mx-auto mb-4 flex max-w-4xl flex-wrap items-center justify-between gap-2">
        <a href="/os/reception" className="btn-ghost">{ar ? "رجوع للاستقبال" : "Back to reception"}</a>
        <div className="flex items-center gap-2">
          <input type="date" name="day" defaultValue={day} className="input w-auto" aria-label={ctx.t("common.date")} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="all" value="1" defaultChecked={!!searchParams.all} />{ar ? "يشمل الملغي" : "Include cancelled"}</label>
          <button className="btn-ghost">{ctx.t("common.search")}</button>
          <PrintButton label={ctx.t("common.print")} />
        </div>
      </form>
      {doctors.length === 0 && <p className="mx-auto max-w-4xl rounded-lg bg-white p-6 text-center text-ink-500">{ar ? "لا توجد مواعيد في هذا اليوم." : "No appointments on this day."}</p>}
      {doctors.map((rows) => (
        <section key={rows[0].doctor_id} data-day-sheet className="sheet mx-auto mb-6 max-w-4xl bg-white p-6 text-sm text-black shadow">
          <header className="mb-3 flex items-end justify-between border-b-2 border-black pb-2">
            <div>
              <h1 className="text-lg font-bold">{ar ? rows[0].doctor?.full_name_ar : rows[0].doctor?.full_name_en ?? rows[0].doctor?.full_name_ar}</h1>
              <p>{ar ? branch?.name_ar : branch?.name_en} · {day} · {ar ? `${rows.length} موعد` : `${rows.length} appointments`}</p>
            </div>
            <p className="text-xs">{ar ? "طُبع" : "Printed"} {printedAt}</p>
          </header>
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="border-b border-black text-xs">
                {[ar ? "الوقت" : "Time", "#", ar ? "رقم الملف" : "File", ar ? "المريض" : "Patient", ar ? "الموبايل" : "Mobile", ar ? "النوع" : "Type", ar ? "الحالة" : "Status", ar ? "حضر ✓" : "Arrived ✓", ar ? "دفع ✓" : "Paid ✓", ar ? "ملاحظات" : "Notes"].map((h) => <th key={h} className="p-1 text-start">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-ivory-300 align-top">
                  <td className="p-1">{timeOnly(rangeStart(a.slot), ctx.locale)}</td>
                  <td className="num p-1">{a.queue_no ?? ""}</td>
                  <td className="num p-1">{a.patient?.mrn}</td>
                  <td className="p-1">{patientName(a.patient, ctx.locale)}</td>
                  <td className="num p-1">{a.patient?.phone}</td>
                  <td className="p-1">{a.type ? (ar ? a.type.name_ar : a.type.name_en) : ""}</td>
                  <td className="p-1">{ctx.t(`apt.status.${a.status}` as DictKey)}</td>
                  <td className="p-1"><span className="inline-block h-4 w-4 border border-black" /></td>
                  <td className="p-1"><span className="inline-block h-4 w-4 border border-black" /></td>
                  <td className="w-40 p-1 text-xs">{a.notes_admin ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs">{ar ? "ورقة احتياطية: سجّل أي حجز أو دفع تم على الورق في النظام فور عودته، واحتفظ بالورقة مع تقفيل اليوم." : "Paper fallback: enter any booking or payment made on paper as soon as the system is back, and keep this sheet with the day close."}</p>
        </section>
      ))}
    </div>
  );
}
