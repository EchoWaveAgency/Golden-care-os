import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, dateTime } from "@/lib/format";
import { CC_STATUS, alertFor, OPEN_STATUSES, queueRank, slaState, duration, telLink, waLink, SOURCE, SOURCES, type Alert } from "@/lib/leads-flow";
import { AutoRefresh, Since } from "@/components/gf/Live";
import { CcPill, GfBanner, GfHeader, Kpi } from "@/components/gf/Frame";
import { QuickActions } from "@/components/gf/Actions";
import { SubmitButton } from "@/components/SubmitButton";
import { createManualLead, setDuty } from "@/app/actions/lead-flow";

export const metadata = { title: "Call center" };
export const dynamic = "force-dynamic";

export type QueueLead = {
  id: string; code: string; full_name: string; phone: string; cc_status: string; source: string; created_at: string; first_contact_at: string | null;
  last_action: string | null; last_action_at: string | null; last_message_at: string | null; next_follow_up_at: string | null; follow_up_reason: string | null;
  booking_at: string | null; booking_service: string | null; message: string | null; assigned_to: string | null;
  campaign: { code: string; service_label: string | null } | null;
};
const COLS = "id, code, full_name, phone, cc_status, source, created_at, first_contact_at, last_action, last_action_at, last_message_at, next_follow_up_at, follow_up_reason, booking_at, booking_service, message, assigned_to, campaign:lead_campaigns(code, service_label)";

const ALERT: Record<Exclude<Alert, null>, { ar: string; en: string; cls: string }> = {
  urgent: { ar: "🔴 عاجل — تجاوز وقت الرد", en: "🔴 URGENT — SLA BREACHED", cls: "bg-red-500/15 text-red-200 ring-1 ring-red-400/50" },
  followup_due: { ar: "🟠 متابعة مستحقة", en: "🟠 FOLLOW-UP DUE", cls: "bg-orange-500/15 text-orange-200 ring-1 ring-orange-400/50" },
  replied: { ar: "💬 العميل رد", en: "💬 CUSTOMER REPLIED", cls: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/50" },
  booked: { ar: "🟢 تم الحجز", en: "🟢 BOOKED", cls: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/50" },
};

export default async function CallCenterPage({ searchParams }: { searchParams: { view?: string; who?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("lead.own", "lead.write");
  const ar = ctx.locale === "ar";
  const supervisor = ctx.can("lead.write");
  const view = ["queue", "followups", "booked", "closed"].includes(searchParams.view ?? "") ? searchParams.view! : "queue";
  const who = supervisor ? (["mine", "all", "unassigned"].includes(searchParams.who ?? "") ? searchParams.who! : "all") : "mine";

  const [{ data: settings }, { data: duty }, { data: names }] = await Promise.all([
    ctx.supabase.from("lead_flow_settings").select("sla_minutes").maybeSingle(),
    ctx.supabase.from("lead_agent_duty").select("on_duty").eq("user_id", ctx.user.id).maybeSingle(),
    ctx.can("lead.assign") || ctx.can("lead.report") ? ctx.supabase.rpc("lead_agents") : Promise.resolve({ data: [] }),
  ]);
  const sla = settings?.sla_minutes ?? 5;
  const ownerName = new Map(((names ?? []) as { user_id: string; full_name: string }[]).map((n) => [n.user_id, n.full_name]));

  let q = ctx.supabase.from("leads").select(COLS).is("archived_at", null);
  if (who === "mine") q = q.eq("assigned_to", ctx.user.id);
  if (who === "unassigned") q = q.is("assigned_to", null);
  if (view === "queue") q = q.in("cc_status", OPEN_STATUSES).order("created_at", { ascending: true }).limit(300);
  if (view === "followups") q = q.eq("cc_status", "follow_up").order("next_follow_up_at", { ascending: true }).limit(300);
  if (view === "booked") q = q.eq("cc_status", "booked").order("booking_at", { ascending: true }).limit(300);
  if (view === "closed") q = q.in("cc_status", ["not_interested", "closed"]).order("updated_at", { ascending: false }).limit(100);
  const { data } = await q.returns<QueueLead[]>();
  const now = new Date();
  const rows = (data ?? []).map((l) => ({ ...l, alert: alertFor(l, sla, now) }));
  if (view === "queue") rows.sort((a, b) => queueRank(a.alert, a.cc_status) - queueRank(b.alert, b.cc_status)
    || (a.alert === "urgent" || a.cc_status === "new" ? +new Date(a.created_at) - +new Date(b.created_at) : +new Date(b.last_action_at ?? b.created_at) - +new Date(a.last_action_at ?? a.created_at)));

  // Latest note per lead.
  const ids = rows.map((r) => r.id);
  const notes = new Map<string, string>();
  if (ids.length) {
    const { data: n } = await ctx.supabase.from("lead_activities").select("lead_id, body").in("lead_id", ids).eq("kind", "note").order("created_at", { ascending: false }).limit(500);
    for (const x of (n ?? []) as { lead_id: string; body: string }[]) if (!notes.has(x.lead_id)) notes.set(x.lead_id, x.body);
  }

  // Counters (same scope) for the alert strip.
  let cq = ctx.supabase.from("leads").select("cc_status, created_at, first_contact_at, next_follow_up_at, last_message_at, last_action_at, booking_at")
    .is("archived_at", null).in("cc_status", [...OPEN_STATUSES, "booked"]).gte("created_at", new Date(Date.now() - 60 * 86400_000).toISOString()).limit(2000);
  if (who === "mine") cq = cq.eq("assigned_to", ctx.user.id);
  if (who === "unassigned") cq = cq.is("assigned_to", null);
  const { data: all } = await cq;
  const alerts = (all ?? []).map((l) => alertFor(l as never, sla, now));
  const contactedToday = (all ?? []).filter((l) => l.first_contact_at && new Date(l.created_at).getTime() > Date.now() - 86400_000);
  const avg = contactedToday.length ? contactedToday.reduce((s, l) => s + (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 1000, 0) / contactedToday.length : null;
  const today = clinicToday();
  const cairoDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
  const followToday = (all ?? []).filter((l) => l.cc_status === "follow_up" && l.next_follow_up_at && cairoDay(l.next_follow_up_at) <= today).length;

  const base = `/os/calls?view=${view}${supervisor ? `&who=${who}` : ""}`;
  const tabs = [
    { href: `/os/calls?view=queue${supervisor ? `&who=${who}` : ""}`, label: ar ? "قائمة العمل" : "Work queue", active: view === "queue" },
    { href: `/os/calls?view=followups${supervisor ? `&who=${who}` : ""}`, label: ar ? "متابعات اليوم" : "Today's follow-ups", active: view === "followups", count: followToday },
    { href: `/os/calls?view=booked${supervisor ? `&who=${who}` : ""}`, label: ar ? "تم الحجز" : "Booked", active: view === "booked" },
    { href: `/os/calls?view=closed${supervisor ? `&who=${who}` : ""}`, label: ar ? "غير مهتم / مغلق" : "Not interested / closed", active: view === "closed" },
  ];

  return (
    <div className="gf">
      <AutoRefresh seconds={15} />
      <GfHeader ar={ar} title={ar ? "مركز الاتصال" : "Call center"}
        subtitle={ar ? `كل عميل يظهر هنا لحظة وصول رسالته · هدف الرد ≤ ${sla} دقائق` : `Every lead appears here the moment it messages · response target ≤ ${sla} min`}
        tabs={tabs}
        actions={<>
          {ctx.can("lead.own") && (
            <form action={setDuty}>
              <input type="hidden" name="on" value={duty?.on_duty ? "0" : "1"} /><input type="hidden" name="back" value="/os/calls" />
              <SubmitButton pendingLabel="…" className={`gf-btn ${duty?.on_duty ? "bg-emerald-500 text-coal-950" : "border border-coal-500 bg-coal-900 text-ivory-300"}`}>
                {duty?.on_duty ? (ar ? "● في الوردية — أستقبل عملاء" : "● On duty — receiving leads") : (ar ? "○ خارج الوردية" : "○ Off duty")}
              </SubmitButton>
            </form>
          )}
          {(ctx.can("lead.report") || ctx.can("lead.assign")) && <Link href="/os/golden" className="gf-btn-ghost">{ar ? "لوحة التحكم" : "Control"}</Link>}
        </>} />
      <GfBanner ar={ar} error={searchParams.error} ok={searchParams.ok} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi tone="red" label={ar ? "🔴 عاجل" : "🔴 Urgent"} value={alerts.filter((a) => a === "urgent").length} hint={ar ? `بدون تواصل > ${sla} د` : `no contact > ${sla} min`} />
        <Kpi tone="gold" label={ar ? "جديد" : "New"} value={(all ?? []).filter((l) => l.cc_status === "new").length} />
        <Kpi tone="orange" label={ar ? "🟠 متابعات مستحقة" : "🟠 Follow-ups due"} value={alerts.filter((a) => a === "followup_due").length} />
        <Kpi tone="plain" label={ar ? "💬 ردود العملاء" : "💬 Customer replies"} value={alerts.filter((a) => a === "replied").length} />
        <Kpi tone="green" label={ar ? "متوسط الرد (24 س)" : "Avg response (24 h)"} value={duration(avg, ar)} hint={ar ? `الهدف ≤ ${sla} د` : `target ≤ ${sla} min`} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {supervisor && (["all", "mine", "unassigned"] as const).map((w) => (
          <Link key={w} href={`/os/calls?view=${view}&who=${w}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${who === w ? "bg-coal-600 text-gold-100" : "text-ivory-300 hover:bg-coal-800"}`}>
            {{ all: ar ? "الكل" : "Everyone", mine: ar ? "المسندة لي" : "Mine", unassigned: ar ? "بدون مسؤول" : "Unassigned" }[w]}
          </Link>
        ))}
        <details data-form className="relative ms-auto">
          <summary className="gf-btn-ghost cursor-pointer list-none">{ar ? "+ عميل جديد (مكالمة)" : "+ New lead (phone call)"}</summary>
          <form action={createManualLead} className="gf-card absolute end-0 z-20 mt-2 w-[min(92vw,380px)] space-y-3 p-4 shadow-2xl">
            <input type="hidden" name="back" value="/os/calls" />
            <label className="block"><span className="gf-label">{ar ? "الاسم" : "Name"}</span><input name="full_name" required minLength={2} maxLength={120} className="gf-input" /></label>
            <label className="block"><span className="gf-label">{ar ? "الموبايل" : "Mobile"}</span><input name="phone" required inputMode="tel" className="gf-input num" placeholder="01xxxxxxxxx" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="gf-label">{ar ? "كود الحملة" : "Campaign code"}</span><input name="campaign_code" className="gf-input num" placeholder="GF26-LASER" /></label>
              <label><span className="gf-label">{ar ? "المصدر" : "Source"}</span>
                <select name="source" className="gf-input" defaultValue="manual">
                  {SOURCES.map((s) => <option key={s} value={s}>{ar ? SOURCE[s].ar : SOURCE[s].en}</option>)}
                </select></label>
            </div>
            <label className="block"><span className="gf-label">{ar ? "الطلب" : "Request"}</span><textarea name="message" rows={2} maxLength={1000} className="gf-input" /></label>
            <SubmitButton pendingLabel="…" className="gf-btn-gold w-full">{ar ? "تسجيل العميل" : "Create lead"}</SubmitButton>
          </form>
        </details>
      </div>

      {rows.length === 0 ? (
        <div className="gf-card p-10 text-center text-ivory-300/70">
          {view === "queue" ? (ar ? "لا يوجد عملاء في قائمتك الآن. العملاء الجدد يظهرون تلقائيًا." : "No leads in your queue. New leads appear automatically.") : (ar ? "لا شيء هنا." : "Nothing here.")}
          {view === "queue" && ctx.can("lead.own") && !duty?.on_duty && <p className="mt-2 text-gold-300">{ar ? "أنت خارج الوردية — لن يُسند لك عملاء جدد." : "You are off duty — no new leads are assigned to you."}</p>}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((l) => {
            const s = slaState(l.created_at, l.first_contact_at, sla, now);
            const a = l.alert;
            return (
              <li key={l.id} data-lead={l.code} className={`gf-card p-4 ${a === "urgent" ? "border-red-400/70 shadow-[0_0_0_1px_rgba(248,113,113,.35)]" : a === "followup_due" ? "border-orange-400/60" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/os/calls/${l.id}`} className="num text-sm font-bold tracking-wide text-gold-300 hover:underline">{l.code}</Link>
                  <CcPill status={l.cc_status} ar={ar} />
                  {a && a !== "booked" && <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${ALERT[a].cls}`}>{ar ? ALERT[a].ar : ALERT[a].en}</span>}
                  <span className="ms-auto text-xs text-ivory-300/70">
                    {l.cc_status === "new"
                      ? <>{ar ? "ينتظر " : "Waiting "}<Since at={l.created_at} ar={ar} className={s.state === "overdue" ? "font-bold text-red-300" : "text-gold-100"} /></>
                      : l.first_contact_at ? <>{ar ? "رد بعد " : "Responded in "}<span className={`num ${s.state === "met" ? "text-emerald-300" : "text-orange-300"}`}>{duration(s.seconds, ar)}</span></> : null}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/os/calls/${l.id}`} className="block truncate text-lg font-semibold text-ivory-50 hover:text-gold-100">{l.full_name}</Link>
                    <p className="num text-sm text-ivory-200">{l.phone}</p>
                  </div>
                  <div className="flex gap-2">
                    <a href={telLink(l.phone)} className="gf-btn-ghost px-3" aria-label={ar ? "اتصال" : "Call"}>📞 {ar ? "اتصال" : "Call"}</a>
                    <a href={waLink(l.phone)} target="_blank" rel="noreferrer" className="gf-btn-ghost px-3" aria-label="WhatsApp">💬</a>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  <div><dt className="gf-muted">{ar ? "الحملة" : "Campaign"}</dt><dd className="num font-semibold text-gold-100">{l.campaign?.code ?? "—"}</dd></div>
                  <div><dt className="gf-muted">{ar ? "المصدر" : "Source"}</dt><dd>{ar ? SOURCE[l.source]?.ar : SOURCE[l.source]?.en}</dd></div>
                  <div><dt className="gf-muted">{ar ? "وصل" : "Received"}</dt><dd className="whitespace-nowrap">{dateTime(l.created_at, ctx.locale)}</dd></div>
                  <div><dt className="gf-muted">{ar ? "آخر إجراء" : "Last action"}</dt><dd>{l.last_action_at ? <>{actionLabel(l.last_action, ar)} · <Since at={l.last_action_at} ar={ar} /></> : "—"}</dd></div>
                  <div><dt className="gf-muted">{ar ? "المتابعة القادمة" : "Next follow-up"}</dt><dd className={a === "followup_due" ? "font-semibold text-orange-300" : ""}>{l.next_follow_up_at ? dateTime(l.next_follow_up_at, ctx.locale) : "—"}</dd></div>
                  {l.cc_status === "booked"
                    ? <div><dt className="gf-muted">{ar ? "الحجز" : "Booking"}</dt><dd className="text-emerald-300">{l.booking_at ? dateTime(l.booking_at, ctx.locale) : "—"}</dd></div>
                    : supervisor ? <div><dt className="gf-muted">{ar ? "المسؤول" : "Owner"}</dt><dd className={l.assigned_to ? "" : "font-semibold text-red-300"}>{l.assigned_to ? ownerName.get(l.assigned_to) ?? "✓" : (ar ? "بدون مسؤول" : "Unassigned")}</dd></div> : null}
                </dl>
                {(notes.get(l.id) || l.message) && (
                  <p className="mt-3 line-clamp-2 rounded-lg bg-coal-900 px-3 py-2 text-xs text-ivory-200">
                    {notes.get(l.id) ? <><span className="gf-muted">{ar ? "ملاحظة: " : "Note: "}</span>{notes.get(l.id)}</> : <><span className="gf-muted">{ar ? "رسالته: " : "Message: "}</span>{l.message}</>}
                  </p>
                )}
                {!["booked", "closed", "not_interested"].includes(l.cc_status) && (
                  <div className="mt-3 space-y-2">
                    <QuickActions id={l.id} ar={ar} back={base} current={l.cc_status} />
                    <Link href={`/os/calls/${l.id}`} className="gf-btn-gold w-full">{ar ? "فتح · متابعة / حجز / ملاحظات" : "Open · follow-up / book / notes"}</Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function actionLabel(a: string | null, ar: boolean) {
  if (!a) return "—";
  const s = CC_STATUS[a as keyof typeof CC_STATUS];
  if (s) return ar ? s.ar : s.en;
  return ({ note: ["ملاحظة", "Note"], whatsapp_reply: ["رد واتساب", "WhatsApp reply"] } as Record<string, [string, string]>)[a]?.[ar ? 0 : 1] ?? a;
}
