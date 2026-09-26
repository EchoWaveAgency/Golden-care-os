import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { updateTicket } from "@/app/actions/support";

export const metadata = { title: "Support tickets" };
export const dynamic = "force-dynamic";

type Ticket = { id: string; ref: string; kind: string; subject: string; body: string | null; status: string; priority: string; due_at: string;
  created_at: string; resolution: string | null; patient_id: string; channel: string; assigned_to: string | null };

const KIND: Record<string, [string, string]> = {
  inquiry: ["استفسار", "Inquiry"], complaint: ["شكوى", "Complaint"], callback: ["طلب اتصال", "Callback"],
  reschedule: ["تغيير موعد", "Reschedule"], refund: ["استرداد", "Refund"],
};
const STATUS: Record<string, [string, string, string]> = {
  open: ["جديد", "Open", "pending_confirmation"], in_progress: ["قيد المعالجة", "In progress", "confirmed"],
  resolved: ["تم الحل", "Resolved", "completed"], closed: ["مغلق", "Closed", "canceled"],
};

export default async function TicketsPage({ searchParams }: { searchParams: { view?: string; error?: string } }) {
  const ctx = await requireAny("ticket.read");
  const { locale } = ctx;
  const ar = locale === "ar";
  const view = ["open", "closed", "all"].includes(searchParams.view ?? "") ? searchParams.view! : "open";
  let q = ctx.supabase.from("support_tickets")
    .select("id, ref, kind, subject, body, status, priority, due_at, created_at, resolution, patient_id, channel, assigned_to")
    .order("created_at", { ascending: false }).limit(200);
  if (view === "open") q = q.in("status", ["open", "in_progress"]);
  if (view === "closed") q = q.in("status", ["resolved", "closed"]);
  const [{ data }, { data: surveys }] = await Promise.all([
    q.returns<Ticket[]>(),
    ctx.supabase.from("satisfaction_surveys").select("score").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
  ]);
  const rows = data ?? [];
  const { data: dir } = rows.length
    ? await ctx.supabase.rpc("patient_directory", { p_ids: Array.from(new Set(rows.map((r) => r.patient_id))) })
    : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; mrn: string; full_name_ar: string; phone?: string }[]).map((p) => [p.id, p]));
  const now = Date.now();
  const open = rows.filter((r) => r.status === "open" || r.status === "in_progress");
  const late = open.filter((r) => new Date(r.due_at).getTime() < now).length;
  const scores = (surveys ?? []).map((s) => s.score as number);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : "—";
  const canWrite = ctx.can("ticket.write");

  return (
    <>
      <PageHeader title={ctx.t("nav.tickets")} subtitle={ar ? "شكاوى واستفسارات المرضى من حساب المريض — كل طلب له مهلة رد" : "Patient complaints and requests from the patient account — each has a response deadline"} />
      <Banner error={searchParams.error} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "مفتوحة" : "Open"} value={open.length} />
        <Stat label={ar ? "تجاوزت المهلة" : "Past deadline"} value={late} tone={late ? "danger" : "navy"} />
        <Stat label={ar ? "شكاوى مفتوحة" : "Open complaints"} value={open.filter((r) => r.kind === "complaint").length} tone="gold" />
        <Stat label={ar ? "متوسط رضا المرضى (30 يومًا)" : "Avg. satisfaction (30 days)"} value={scores.length ? `${avg} / 5` : "—"} tone="teal" />
      </div>
      <nav className="mb-4 flex flex-wrap gap-2">
        {([["open", "مفتوحة", "Open"], ["closed", "مغلقة", "Closed"], ["all", "الكل", "All"]] as const).map(([k, a, e]) => (
          <Link key={k} href={`/os/tickets?view=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <div className="card"><Empty text={ctx.t("common.none")} /></div> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const overdue = (r.status === "open" || r.status === "in_progress") && new Date(r.due_at).getTime() < now;
            const p = names.get(r.patient_id);
            const st = STATUS[r.status];
            return (
              <article key={r.id} className={`card p-5 ${overdue ? "border-danger/40" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm"><span className="num font-medium text-navy-700">{r.ref}</span>
                      <span className={`ms-2 rounded-full px-2 py-0.5 text-xs ${r.kind === "complaint" ? "bg-danger-50 text-danger" : "bg-ivory-200 text-ink-500"}`}>{ar ? KIND[r.kind]?.[0] : KIND[r.kind]?.[1]}</span></p>
                    <h3 className="mt-1 font-medium">{r.subject}</h3>
                    {r.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-500">{r.body}</p>}
                    <p className="mt-2 text-xs text-ink-300">
                      {p ? <>{p.full_name_ar} · <span className="num">{p.mrn}</span> · </> : null}
                      {dateTime(r.created_at, locale)} · {ar ? "المهلة" : "Due"} <span className={overdue ? "font-medium text-danger" : ""}>{dateTime(r.due_at, locale)}</span>
                    </p>
                  </div>
                  <StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? r.status} />
                </div>
                {r.resolution && <p className="mt-3 rounded-lg bg-ok/10 p-3 text-sm">{r.resolution}</p>}
                {canWrite && (r.status === "open" || r.status === "in_progress") && (
                  <form action={updateTicket} className="mt-4 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="min-w-[240px] flex-1">
                      <label className="label" htmlFor={`res-${r.id}`}>{ar ? "ما تم (يظهر للمريض عند الإغلاق)" : "Resolution (shown to the patient when closed)"}</label>
                      <input id={`res-${r.id}`} name="resolution" className="input" />
                    </div>
                    <select name="status" className="input w-auto" defaultValue={r.status === "open" ? "in_progress" : "resolved"}>
                      <option value="in_progress">{ar ? "استلام / قيد المعالجة" : "Take / in progress"}</option>
                      <option value="resolved">{ar ? "تم الحل" : "Resolved"}</option>
                      <option value="closed">{ar ? "إغلاق" : "Close"}</option>
                    </select>
                    <SubmitButton pendingLabel="…" className="btn-primary">{ctx.t("common.save")}</SubmitButton>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
