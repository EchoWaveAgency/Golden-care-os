import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, rangeStart } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { LEAD_STATUS, LEAD_KIND } from "@/lib/leads";

export const metadata = { title: "Patient relations" };
export const dynamic = "force-dynamic";

type Lead = { id: string; ref: string; kind: string; status: string; full_name: string; phone: string; created_at: string; due_at: string | null;
  preferred_slot: string | null; utm_source: string | null; utm_campaign: string | null; channel: string; assigned_to: string | null;
  specialty: { name_ar: string; name_en: string } | null; doctor: { full_name_ar: string; full_name_en: string | null } | null };

const OPEN = ["inquiry", "contacted", "qualified", "appointment_requested"];

export default async function LeadsPage({ searchParams }: { searchParams: { view?: string } }) {
  const ctx = await requireAny("lead.read");
  const { locale } = ctx;
  const ar = locale === "ar";
  const view = ["open", "mine", "converted", "closed", "all"].includes(searchParams.view ?? "") ? searchParams.view! : "open";

  let q = ctx.supabase.from("leads")
    .select("id, ref, kind, status, full_name, phone, created_at, due_at, preferred_slot, utm_source, utm_campaign, channel, assigned_to, specialty:specialties(name_ar, name_en), doctor:staff(full_name_ar, full_name_en)")
    .order("created_at", { ascending: false }).limit(200);
  if (view === "open") q = q.in("status", OPEN);
  if (view === "mine") q = q.eq("assigned_to", ctx.user.id).in("status", OPEN);
  if (view === "converted") q = q.in("status", ["appointment_confirmed", "arrived", "visit_completed", "follow_up_completed"]);
  if (view === "closed") q = q.eq("status", "closed");
  const { data } = await q.returns<Lead[]>();
  const rows = data ?? [];
  const now = Date.now();
  const overdue = rows.filter((r) => r.status === "inquiry" && r.due_at && new Date(r.due_at).getTime() < now).length;

  const views: [string, string, string][] = [["open", "مفتوحة", "Open"], ["mine", "المسندة لي", "Assigned to me"], ["converted", "تحولت لمواعيد", "Converted"], ["closed", "مغلقة", "Closed"], ["all", "الكل", "All"]];
  return (
    <>
      <PageHeader title={ctx.t("nav.leads")} subtitle={ar ? "استفسارات الموقع والحملات والمكالمات وواتساب في صندوق واحد" : "Website, campaign, call and WhatsApp inquiries in one queue"} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "مفتوحة" : "Open"} value={rows.filter((r) => OPEN.includes(r.status)).length} />
        <Stat label={ar ? "لم يتم الرد في الوقت المحدد" : "Past response SLA"} value={overdue} tone={overdue ? "danger" : "navy"} />
        <Stat label={ar ? "طلبات حجز" : "Booking requests"} value={rows.filter((r) => r.kind === "booking" && OPEN.includes(r.status)).length} tone="teal" />
        <Stat label={ar ? "طلبات اتصال" : "Callback requests"} value={rows.filter((r) => r.kind === "callback" && OPEN.includes(r.status)).length} tone="gold" />
      </div>
      <nav className="mb-4 flex flex-wrap gap-2">
        {views.map(([k, a, e]) => (
          <Link key={k} href={`/os/leads?view=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>
        ))}
      </nav>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{ar ? "الطلب" : "Request"}</th>
                <th className="th">{ar ? "الاسم" : "Name"}</th>
                <th className="th">{ar ? "التخصص / الطبيب" : "Specialty / doctor"}</th>
                <th className="th">{ar ? "الموعد المفضل" : "Preferred time"}</th>
                <th className="th">{ar ? "المصدر" : "Source"}</th>
                <th className="th">{ar ? "الحالة" : "Status"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200 text-sm">
              {rows.map((r) => {
                const late = r.status === "inquiry" && r.due_at && new Date(r.due_at).getTime() < now;
                return (
                  <tr key={r.id} className={late ? "bg-danger-50/50" : "hover:bg-ivory-50"}>
                    <td className="td">
                      <Link href={`/os/leads/${r.id}`} className="num font-medium text-navy-700 hover:underline">{r.ref}</Link>
                      <p className="text-xs text-ink-300">{ar ? LEAD_KIND[r.kind]?.ar : LEAD_KIND[r.kind]?.en} · <span className="whitespace-nowrap">{dateTime(r.created_at, locale)}</span></p>
                    </td>
                    <td className="td">{r.full_name}<p className="num text-xs text-ink-300">{r.phone}</p></td>
                    <td className="td text-ink-500">{(ar ? r.specialty?.name_ar : r.specialty?.name_en) ?? "—"}{r.doctor ? ` · ${ar ? r.doctor.full_name_ar : r.doctor.full_name_en ?? r.doctor.full_name_ar}` : ""}</td>
                    <td className="td whitespace-nowrap">{r.preferred_slot ? dateTime(rangeStart(r.preferred_slot), locale) : "—"}</td>
                    <td className="td text-xs text-ink-500">{[r.utm_source, r.utm_campaign].filter(Boolean).join(" / ") || r.channel}</td>
                    <td className="td">
                      <StatusBadge status={r.status === "inquiry" ? "pending_confirmation" : r.status === "closed" ? "canceled" : OPEN.includes(r.status) ? "confirmed" : "completed"}
                        label={(ar ? LEAD_STATUS[r.status]?.ar : LEAD_STATUS[r.status]?.en) ?? r.status} />
                      {late && <p className="mt-1 text-xs font-medium text-danger">{ar ? "متأخر عن وقت الرد" : "Response overdue"}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
