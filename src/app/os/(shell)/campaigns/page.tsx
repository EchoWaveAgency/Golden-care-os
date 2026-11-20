import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicOffset, clinicToday, dateTime } from "@/lib/format";
import { duration, pct, periodFor, SOURCE, CC_STATUS, type CcStatus } from "@/lib/leads-flow";
import { AutoRefresh, Since } from "@/components/gf/Live";
import { GfBanner, GfFlow, GfHeader, Kpi } from "@/components/gf/Frame";
import { SubmitButton } from "@/components/SubmitButton";
import { assignLead } from "@/app/actions/lead-flow";

export const metadata = { title: "Campaigns control" };
export const dynamic = "force-dynamic";

type Dash = { total: number; by_status: Record<CcStatus, number>; contacted: number; interested: number; booked: number; no_response: number;
  avg_response_seconds: number | null; sla_met: number; sla_counted: number; overdue_now: number; unassigned: number; followups_due: number; sla_minutes: number };
type CampRow = { campaign_id: string | null; code: string; name_ar: string; name_en: string; leads: number; contacted: number; interested: number; follow_ups: number;
  booked: number; no_response: number; avg_response_seconds: number | null; sla_met: number; sla_counted: number };
type AgentRow = { user_id: string | null; full_name: string; assigned: number; contacted: number; interested: number; follow_ups: number; booked: number;
  no_response: number; open_new: number; avg_response_seconds: number | null; sla_met: number; sla_counted: number };
type DayRow = { day: string; leads: number; still_new: number; contacted: number; interested: number; follow_ups: number; booked: number; no_response: number;
  avg_response_seconds: number | null; sla_met: number; sla_counted: number };
type SrcRow = { source: string; ad_id: string | null; ad_name: string | null; adset_name: string | null; meta_campaign_name: string | null; leads: number; contacted: number; booked: number };
type AlertLead = { id: string; code: string; full_name: string; cc_status: string; created_at: string; next_follow_up_at: string | null; booking_at: string | null;
  booking_service: string | null; assigned_to: string | null; campaign: { code: string } | null };

type GrowthRow = { code: string; name_ar: string; name_en: string; phase: number; baseline_month: number; target_p1: number; target_p2: number; target_p3: number;
  target_month: number; target_patients: number; actual_patients: number; target_leads: number; actual_leads: number; booked: number };
type GrowthSettings = { phase1_start: string | null; phase_weeks: number; booking_rate: number; show_rate: number; new_lead_share: number; weeks_per_month: number };

const isDate = (s?: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

export default async function GoldenControl({ searchParams }: { searchParams: { p?: string; from?: string; to?: string; c?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("lead.report", "lead.assign");
  const ar = ctx.locale === "ar";
  const today = clinicToday();
  const preset = periodFor(searchParams.p, today);
  const from = isDate(searchParams.from) ? searchParams.from! : preset.from;
  const to = isDate(searchParams.to) ? searchParams.to! : preset.to;
  const campaign = searchParams.c && /^[0-9a-f-]{36}$/.test(searchParams.c) ? searchParams.c : null;

  const [dash, camps, agents, days, sources, list, people, growth, gset] = await Promise.all([
    ctx.supabase.rpc("lead_dashboard", { p_from: from, p_to: to, p_campaign: campaign }),
    ctx.supabase.rpc("lead_campaign_report", { p_from: from, p_to: to }),
    ctx.supabase.rpc("lead_agent_report", { p_from: from, p_to: to }),
    ctx.supabase.rpc("lead_daily_report", { p_from: from, p_to: to, p_campaign: campaign }),
    ctx.supabase.rpc("lead_source_report", { p_from: from, p_to: to }),
    ctx.supabase.from("lead_campaigns").select("id, code").order("code"),
    ctx.supabase.rpc("lead_agents"),
    ctx.supabase.rpc("growth_progress", { p_from: from, p_to: to }),
    ctx.supabase.from("growth_settings").select("phase1_start, phase_weeks, booking_rate, show_rate, new_lead_share, weeks_per_month").maybeSingle<GrowthSettings>(),
  ]);
  const d = (dash.data ?? {}) as Dash;
  const total = d.total ?? 0;
  const sla = d.sla_minutes ?? 5;

  // Live alert lists (not limited to the period: what needs a person right now).
  const cutoff = new Date(Date.now() - sla * 60_000).toISOString();
  const [urgent, unassigned, dueFollow, bookedToday] = await Promise.all([
    ctx.supabase.from("leads").select("id, code, full_name, cc_status, created_at, next_follow_up_at, booking_at, booking_service, assigned_to, campaign:lead_campaigns(code)")
      .is("archived_at", null).eq("cc_status", "new").is("first_contact_at", null).lt("created_at", cutoff).order("created_at").limit(30).returns<AlertLead[]>(),
    ctx.supabase.from("leads").select("id, code, full_name, cc_status, created_at, next_follow_up_at, booking_at, booking_service, assigned_to, campaign:lead_campaigns(code)")
      .is("archived_at", null).is("assigned_to", null).in("cc_status", ["new", "contacted", "interested", "no_response", "follow_up"]).order("created_at").limit(30).returns<AlertLead[]>(),
    ctx.supabase.from("leads").select("id, code, full_name, cc_status, created_at, next_follow_up_at, booking_at, booking_service, assigned_to, campaign:lead_campaigns(code)")
      .is("archived_at", null).eq("cc_status", "follow_up").lte("next_follow_up_at", new Date().toISOString()).order("next_follow_up_at").limit(30).returns<AlertLead[]>(),
    ctx.supabase.from("leads").select("id, code, full_name, cc_status, created_at, next_follow_up_at, booking_at, booking_service, assigned_to, campaign:lead_campaigns(code)")
      .is("archived_at", null).eq("cc_status", "booked").gte("updated_at", new Date(`${today}T00:00:00${clinicOffset()}`).toISOString()).order("updated_at", { ascending: false }).limit(30).returns<AlertLead[]>(),
  ]);
  const staff = (people.data ?? []) as { user_id: string; full_name: string; is_agent: boolean; on_duty: boolean; open_leads: number; new_leads: number }[];
  const nameOf = new Map(staff.map((s) => [s.user_id, s.full_name]));
  const onDuty = staff.filter((s) => s.is_agent && s.on_duty);

  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(searchParams.p ? { p: searchParams.p } : {}), ...(isDate(searchParams.from) ? { from, to } : {}), ...(campaign ? { c: campaign } : {}) });
    for (const [k, v] of Object.entries(extra)) { if (v == null) p.delete(k); else p.set(k, v); }
    return `/os/campaigns?${p.toString()}`;
  };
  const presets: [string, string, string][] = [["today", "اليوم", "Today"], ["yesterday", "أمس", "Yesterday"], ["7d", "آخر 7 أيام", "Last 7 days"], ["month", "هذا الشهر", "This month"], ["30d", "آخر 30 يومًا", "Last 30 days"]];

  return (
    <div className="gf">
      <AutoRefresh seconds={30} />
      <GfHeader ar={ar} title={ar ? "لوحة تحكم الحملات والكول سنتر" : "Campaigns & call center control"}
        subtitle={ar ? "كل الأرقام من قاعدة البيانات مباشرة — النظام هو المصدر الوحيد للحقيقة." : "Every number comes straight from the database — the system is the single source of truth."}
        actions={<>
          <Link href="/os/calls" className="gf-btn-ghost">{ar ? "مركز الاتصال" : "Call center"}</Link>
          {ctx.can("lead.export") && <a href={`/os/campaigns/export?from=${from}&to=${to}`} className="gf-btn-ghost">{ar ? "تصدير CSV" : "Export CSV"}</a>}
          {ctx.can("lead.campaigns") && <Link href="/os/campaigns/settings" className="gf-btn-gold">{ar ? "الحملات والإعدادات" : "Campaigns & settings"}</Link>}
        </>} />
      <GfBanner ar={ar} error={searchParams.error} ok={searchParams.ok} />
      <GfFlow ar={ar} />

      <form className="mb-5 flex flex-wrap items-end gap-2" action="/os/campaigns">
        <div className="flex flex-wrap gap-1">
          {presets.map(([k, a, e]) => (
            <Link key={k} href={qs({ p: k, from: null, to: null })}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${!isDate(searchParams.from) && preset.key === k ? "bg-gold-300 text-coal-950" : "bg-coal-800 text-ivory-200 hover:bg-coal-700"}`}>{ar ? a : e}</Link>
          ))}
        </div>
        <label><span className="gf-label">{ar ? "من" : "From"}</span><input type="date" name="from" defaultValue={from} className="gf-input num" /></label>
        <label><span className="gf-label">{ar ? "إلى" : "To"}</span><input type="date" name="to" defaultValue={to} className="gf-input num" /></label>
        <label><span className="gf-label">{ar ? "الحملة" : "Campaign"}</span>
          <select name="c" defaultValue={campaign ?? ""} className="gf-input">
            <option value="">{ar ? "كل الحملات" : "All campaigns"}</option>
            {((list.data ?? []) as { id: string; code: string }[]).map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select></label>
        <button className="gf-btn-ghost">{ar ? "عرض" : "Show"}</button>
      </form>

      {/* Status counts */}
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5 xl:grid-cols-9" data-dashboard>
        <Kpi tone="plain" label={ar ? "إجمالي العملاء" : "Total leads"} value={total} />
        {(["new", "contacted", "interested", "follow_up", "booked", "no_response", "not_interested", "closed"] as CcStatus[]).map((s) => (
          <Kpi key={s} tone={s === "booked" ? "green" : s === "new" ? "gold" : s === "no_response" ? "orange" : "plain"}
            label={ar ? CC_STATUS[s].ar : CC_STATUS[s].en} value={d.by_status?.[s] ?? 0} />
        ))}
      </section>
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi tone={d.avg_response_seconds != null && d.avg_response_seconds <= sla * 60 ? "green" : "red"} label={ar ? "متوسط أول رد" : "Avg first response"}
          value={duration(d.avg_response_seconds, ar)} hint={ar ? `الهدف ≤ ${sla} د` : `Target ≤ ${sla} min`} />
        <Kpi tone="gold" label={ar ? "الالتزام بزمن الرد" : "SLA compliance"} value={pct(d.sla_met ?? 0, d.sla_counted ?? 0)} hint={`${d.sla_met ?? 0} / ${d.sla_counted ?? 0}`} />
        <Kpi tone="plain" label={ar ? "نسبة التواصل" : "Contact rate"} value={pct(d.contacted ?? 0, total)} />
        <Kpi tone="plain" label={ar ? "نسبة الاهتمام" : "Interest rate"} value={pct(d.interested ?? 0, total)} />
        <Kpi tone="green" label={ar ? "نسبة الحجز" : "Booking rate"} value={pct(d.booked ?? 0, total)} />
        <Kpi tone="orange" label={ar ? "نسبة عدم الرد" : "No-response rate"} value={pct(d.no_response ?? 0, total)} />
      </section>

      {/* Critical alerts */}
      <section className="mb-6 grid gap-3 lg:grid-cols-4">
        {[
          { key: "urgent", title: ar ? `🔴 عاجل — بدون تواصل > ${sla} د` : `🔴 URGENT — no contact > ${sla} min`, rows: urgent.data ?? [], tone: "border-red-400/60" },
          { key: "unassigned", title: ar ? "⚠ بدون مسؤول" : "⚠ No owner", rows: unassigned.data ?? [], tone: "border-red-400/40" },
          { key: "follow", title: ar ? "🟠 متابعات مستحقة" : "🟠 FOLLOW-UP DUE", rows: dueFollow.data ?? [], tone: "border-orange-400/50" },
          { key: "booked", title: ar ? "🟢 حجوزات اليوم" : "🟢 BOOKED today", rows: bookedToday.data ?? [], tone: "border-emerald-400/50" },
        ].map((b) => (
          <div key={b.key} className={`gf-card p-3 ${b.rows.length ? b.tone : ""}`} data-alert={b.key}>
            <h3 className="mb-2 flex items-center justify-between text-xs font-bold tracking-wide">{b.title}<span className="num text-lg">{b.rows.length}</span></h3>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {b.rows.map((r) => (
                <li key={r.id} className="rounded-lg bg-coal-900 px-2.5 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Link href={`/os/calls/${r.id}`} className="num font-bold text-gold-300 hover:underline">{r.code}</Link>
                    <span className="truncate">{r.full_name}</span>
                    <span className="num ms-auto text-ivory-300/70">{r.campaign?.code}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-ivory-300/80">
                    {b.key === "urgent" && <>{ar ? "ينتظر " : "Waiting "}<Since at={r.created_at} ar={ar} className="font-bold text-red-300" /> · {r.assigned_to ? nameOf.get(r.assigned_to) ?? "✓" : <span className="text-red-300">{ar ? "بدون مسؤول" : "unassigned"}</span>}</>}
                    {b.key === "follow" && <>{r.next_follow_up_at && dateTime(r.next_follow_up_at, ctx.locale)} · {r.assigned_to ? nameOf.get(r.assigned_to) : "—"}</>}
                    {b.key === "booked" && <>{r.booking_at && dateTime(r.booking_at, ctx.locale)} · {r.booking_service}</>}
                    {b.key === "unassigned" && ctx.can("lead.assign") && (
                      <form action={assignLead} className="flex w-full gap-1">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="/os/campaigns" />
                        <select name="user" required defaultValue="" className="gf-input py-1 text-xs" aria-label={ar ? "إسناد إلى" : "Assign to"}>
                          <option value="" disabled>{ar ? "إسناد إلى…" : "Assign to…"}</option>
                          {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}{s.is_agent ? (s.on_duty ? " ●" : " ○") : ""}</option>)}
                        </select>
                        <SubmitButton pendingLabel="…" className="gf-btn-ghost min-h-0 px-2 py-1 text-xs">{ar ? "إسناد" : "Assign"}</SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
              {b.rows.length === 0 && <li className="text-xs text-ivory-300/50">{ar ? "لا شيء" : "None"}</li>}
            </ul>
          </div>
        ))}
      </section>

      <p className="mb-6 text-xs text-ivory-300/70">
        {ar ? "في الوردية الآن: " : "On duty now: "}
        {onDuty.length ? onDuty.map((s) => `${s.full_name} (${s.new_leads} ${ar ? "جديد" : "new"})`).join(" · ") : <span className="font-semibold text-red-300">{ar ? "لا أحد — العملاء الجدد لن يُسندوا تلقائيًا" : "nobody — new leads will not be auto-assigned"}</span>}
      </p>

      <Growth ar={ar} rows={(growth.data ?? []) as GrowthRow[]} settings={gset.data} measuredBooking={total ? (d.booked ?? 0) / total : null}
        leads={total} from={from} to={to} canEdit={ctx.can("lead.campaigns")} />

      {/* Campaign performance */}
      <Table title={ar ? "أداء الحملات" : "Campaign performance"} head={[ar ? "الحملة" : "Campaign", ar ? "عملاء" : "Leads", ar ? "تواصل" : "Contacted", ar ? "مهتم" : "Interested",
        ar ? "متابعات" : "Follow-ups", ar ? "حجز" : "Booked", ar ? "نسبة الحجز" : "Booking rate", ar ? "متوسط الرد" : "Avg response", "SLA"]}
        rows={((camps.data ?? []) as CampRow[]).map((c) => [
          <span key="c"><span className="num font-semibold text-gold-100">{c.code}</span><span className="gf-muted block text-[11px]">{ar ? c.name_ar : c.name_en}</span></span>,
          c.leads, c.contacted, c.interested, c.follow_ups, c.booked, pct(c.booked, c.leads), duration(c.avg_response_seconds, ar), pct(c.sla_met, c.sla_counted)])} />

      {/* Agents */}
      <Table title={ar ? "أداء موظفي الكول سنتر" : "Call center agents"} head={[ar ? "الموظف" : "Agent", ar ? "مسند" : "Assigned", ar ? "تواصل" : "Contacted", ar ? "مهتم" : "Interested",
        ar ? "متابعات" : "Follow-ups", ar ? "حجز" : "Bookings", ar ? "لا يرد" : "No response", ar ? "جديد بدون تواصل" : "Untouched", ar ? "متوسط الرد" : "Avg response", "SLA"]}
        rows={((agents.data ?? []) as AgentRow[]).map((a) => [
          <span key="n" className={a.user_id ? "" : "font-semibold text-red-300"}>{a.full_name}</span>, a.assigned, a.contacted, a.interested, a.follow_ups, a.booked,
          a.no_response, a.open_new, duration(a.avg_response_seconds, ar), pct(a.sla_met, a.sla_counted)])} />

      {/* Daily */}
      <Table title={ar ? "التقرير اليومي" : "Daily report"} head={[ar ? "اليوم" : "Day", ar ? "عملاء" : "Leads", ar ? "ما زال جديد" : "Still new", ar ? "تواصل" : "Contacted",
        ar ? "مهتم" : "Interested", ar ? "متابعات" : "Follow-ups", ar ? "حجز" : "Bookings", ar ? "لا يرد" : "No response", ar ? "متوسط الرد" : "Avg response", "SLA %"]}
        rows={((days.data ?? []) as DayRow[]).map((r) => [<span key="d" className="num">{r.day}</span>, r.leads, r.still_new, r.contacted, r.interested, r.follow_ups, r.booked, r.no_response,
          duration(r.avg_response_seconds, ar), pct(r.sla_met, r.sla_counted)])} />

      {/* Source / ad */}
      <Table title={ar ? "المصدر والإعلان" : "Source & ad"} head={[ar ? "المصدر" : "Source", ar ? "الإعلان" : "Ad", ar ? "المجموعة" : "Ad set", ar ? "حملة ميتا" : "Meta campaign",
        ar ? "عملاء" : "Leads", ar ? "تواصل" : "Contacted", ar ? "حجز" : "Booked"]}
        rows={((sources.data ?? []) as SrcRow[]).map((r) => [ar ? SOURCE[r.source]?.ar : SOURCE[r.source]?.en,
          <span key="a" className="num">{r.ad_name ?? r.ad_id ?? "—"}</span>, r.adset_name ?? "—", r.meta_campaign_name ?? "—", r.leads, r.contacted, r.booked])} />

      <p className="mt-6 text-[11px] text-ivory-300/60">
        {ar ? `الفترة ${from} → ${to} (تاريخ وصول العميل بتوقيت القاهرة). العملاء المؤرشفون مستبعدون. التواصل = أول إجراء من الكول سنتر (اتصال، رد، لا يرد…). SLA = نسبة من تم التواصل معهم خلال ${sla} دقائق من كل من تم التواصل معهم أو تجاوزوا الوقت.`
            : `Period ${from} → ${to} (lead received date, Cairo time). Archived leads excluded. Contact = first call-center action (call, reply, no answer…). SLA = share contacted within ${sla} min of all leads contacted or past the window.`}
      </p>
    </div>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <section className="gf-card mb-5 overflow-x-auto">
      <h2 className="border-b border-coal-600 px-4 py-3 text-sm font-semibold text-gold-100">{title}</h2>
      {rows.length === 0 ? <p className="px-4 py-6 text-sm text-ivory-300/60">—</p> : (
        <table className="w-full min-w-[760px]">
          <thead><tr>{head.map((h) => <th key={h} className="gf-th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-coal-600/70">
            {rows.map((r, i) => <tr key={i} className="hover:bg-coal-700/40">{r.map((c, j) => <td key={j} className={`gf-td ${typeof c === "number" ? "num" : ""}`}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Department targets from the growth plan: actual vs target for the selected period, per phase. */
function Growth({ ar, rows, settings, measuredBooking, leads, from, to, canEdit }: { ar: boolean; rows: GrowthRow[]; settings: GrowthSettings | null;
  measuredBooking: number | null; leads: number; from: string; to: string; canEdit: boolean }) {
  if (!rows.length || !settings) return null;
  const phase = rows[0].phase;
  const sum = (k: keyof GrowthRow) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const f1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
  const p = (n: number) => `${Math.round(n * 100)}%`;
  const bar = (actual: number, target: number) => {
    if (!target) return <span className="gf-muted">—</span>;
    const r = actual / target;
    const tone = r >= 1 ? "bg-emerald-400" : r >= 0.7 ? "bg-gold-300" : "bg-red-400";
    return (
      <span className="flex min-w-[110px] items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-coal-700"><span className={`block h-full ${tone}`} style={{ width: `${Math.min(100, r * 100)}%` }} /></span>
        <span className={`num text-xs ${r >= 1 ? "text-emerald-300" : r >= 0.7 ? "text-gold-200" : "text-red-300"}`}>{p(r)}</span>
      </span>
    );
  };
  const phaseCell = (r: GrowthRow, n: 1 | 2 | 3) => {
    const v = n === 1 ? r.target_p1 : n === 2 ? r.target_p2 : r.target_p3;
    return <span className={n === phase ? "font-bold text-gold-200" : "gf-muted"}>{v}</span>;
  };
  const tot = { tp: sum("target_patients"), ap: sum("actual_patients"), tl: sum("target_leads"), al: sum("actual_leads"), b: sum("booked") };
  return (
    <section className="gf-card mb-5 overflow-x-auto" data-growth>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-coal-600 px-4 py-3">
        <h2 className="text-sm font-semibold text-gold-100">{ar ? `أهداف الأقسام — المرحلة ${phase}` : `Department targets — phase ${phase}`}</h2>
        <span className="text-[11px] text-ivory-300/70">
          {ar ? "الافتراضات: " : "Assumptions: "}
          {ar ? "حجز من العملاء " : "lead → booked "}<span className="num">{p(settings.booking_rate)}</span>
          {measuredBooking != null && leads >= 20 && <> ({ar ? "الفعلي " : "measured "}<span className={`num ${measuredBooking >= settings.booking_rate ? "text-emerald-300" : "text-red-300"}`}>{p(measuredBooking)}</span>)</>}
          {" · "}{ar ? "حضور " : "booked → attended "}<span className="num">{p(settings.show_rate)}</span>
          {" · "}{ar ? "بداية المرحلة الأولى: " : "phase 1 start: "}<span className="num">{settings.phase1_start ?? (ar ? "لم تُحدد" : "not set")}</span>
        </span>
        {canEdit && <Link href="/os/campaigns/settings#growth" className="ms-auto text-xs text-gold-300 hover:underline">{ar ? "تعديل الأهداف" : "Edit targets"}</Link>}
      </div>
      <table className="w-full min-w-[980px]">
        <thead><tr>
          {[ar ? "القسم" : "Department", ar ? "اليوم / شهر" : "Today / mo", ar ? "م١" : "P1", ar ? "م٢" : "P2", ar ? "م٣" : "P3",
            ar ? "مرضى مستهدف" : "Target patients", ar ? "مرضى فعلي" : "Actual patients", ar ? "التقدم" : "Progress",
            ar ? "عملاء مستهدف" : "Target leads", ar ? "عملاء فعلي" : "Actual leads", ar ? "التقدم" : "Progress", ar ? "حجز" : "Booked"].map((h, i) => <th key={i} className="gf-th">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-coal-600/70">
          {rows.map((r) => (
            <tr key={r.code} className="hover:bg-coal-700/40">
              <td className="gf-td font-semibold">{ar ? r.name_ar : r.name_en}</td>
              <td className="gf-td num">{r.baseline_month}</td>
              <td className="gf-td num">{phaseCell(r, 1)}</td><td className="gf-td num">{phaseCell(r, 2)}</td><td className="gf-td num">{phaseCell(r, 3)}</td>
              <td className="gf-td num">{f1(r.target_patients)}</td>
              <td className="gf-td num">{r.actual_patients}</td>
              <td className="gf-td">{bar(r.actual_patients, Number(r.target_patients))}</td>
              <td className="gf-td num">{f1(r.target_leads)}</td>
              <td className="gf-td num">{r.actual_leads}</td>
              <td className="gf-td">{bar(r.actual_leads, Number(r.target_leads))}</td>
              <td className="gf-td num">{r.booked}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="gf-td">{ar ? "الإجمالي" : "Total"}</td>
            <td className="gf-td num">{sum("baseline_month")}</td><td className="gf-td num">{sum("target_p1")}</td><td className="gf-td num">{sum("target_p2")}</td><td className="gf-td num">{sum("target_p3")}</td>
            <td className="gf-td num">{f1(tot.tp)}</td><td className="gf-td num">{tot.ap}</td><td className="gf-td">{bar(tot.ap, tot.tp)}</td>
            <td className="gf-td num">{f1(tot.tl)}</td><td className="gf-td num">{tot.al}</td><td className="gf-td">{bar(tot.al, tot.tl)}</td><td className="gf-td num">{tot.b}</td>
          </tr>
        </tbody>
      </table>
      <p className="px-4 py-2 text-[11px] text-ivory-300/60">
        {ar ? `المستهدف محسوب للفترة ${from} → ${to} من هدف الشهر للمرحلة الحالية. المرضى الفعليون = مرضى مختلفون حضروا موعدًا في تخصصات القسم. العملاء الفعليون = عملاء الحملات المرتبطة بالقسم. عملاء مستهدف = (هدف المرحلة − مرضى اليوم) ÷ (نسبة الحجز × نسبة الحضور).`
            : `Targets are prorated for ${from} → ${to} from the current phase's monthly target. Actual patients = distinct patients who attended an appointment in the department's specialties. Actual leads = leads from campaigns linked to the department. Target leads = (phase target − today's patients) ÷ (booking rate × show rate).`}
      </p>
    </section>
  );
}
