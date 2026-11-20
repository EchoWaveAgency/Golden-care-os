import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { messagingMode } from "@/lib/messaging/provider";
import { duration, slaState, SOURCE, telLink, waLink, alertFor } from "@/lib/leads-flow";
import { AutoRefresh, Since } from "@/components/gf/Live";
import { CcPill, GfBanner } from "@/components/gf/Frame";
import { FullActions } from "@/components/gf/Actions";
import { SubmitButton } from "@/components/SubmitButton";
import { addLeadNote, archiveLead, assignLead, sendLeadReply } from "@/app/actions/lead-flow";

export const metadata = { title: "Lead" };
export const dynamic = "force-dynamic";

type Lead = {
  id: string; code: string; full_name: string; phone: string; whatsapp_name: string | null; cc_status: string; status: string; source: string;
  created_at: string; first_contact_at: string | null; assigned_to: string | null; assigned_at: string | null; message: string | null;
  last_action: string | null; last_action_at: string | null; last_message_at: string | null; next_follow_up_at: string | null; follow_up_reason: string | null;
  follow_up_count: number; last_follow_up_at: string | null; booking_at: string | null; booking_service: string | null; booking_notes: string | null;
  archived_at: string | null; archive_reason: string | null; ad_id: string | null; ad_name: string | null; adset_name: string | null;
  meta_campaign_name: string | null; referral: { headline?: string; source_url?: string; source_type?: string } | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; patient_id: string | null; appointment_id: string | null; branch_id: string;
  campaign: { code: string; name_ar: string; name_en: string; service_label: string | null } | null;
};
type Item = { at: string; kind: string; direction: string | null; body: string | null; actor: string | null; status: string | null };

export default async function LeadWorkspace({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string; open?: string } }) {
  const ctx = await requireAny("lead.own", "lead.write", "lead.read", "lead.report");
  const ar = ctx.locale === "ar";
  const { data: l } = await ctx.supabase.from("leads")
    .select("*, campaign:lead_campaigns(code, name_ar, name_en, service_label)").eq("id", params.id).maybeSingle<Lead>();
  if (!l) {
    return (
      <div className="gf"><div className="gf-card p-10 text-center">
        <p className="text-lg">{ar ? "هذا العميل غير موجود أو غير مسند لك." : "This lead does not exist or is not assigned to you."}</p>
        <Link href="/os/calls" className="gf-btn-gold mt-4">{ar ? "العودة لقائمة العمل" : "Back to the queue"}</Link>
      </div></div>
    );
  }
  const [{ data: settings }, { data: timeline }, { data: agents }] = await Promise.all([
    ctx.supabase.from("lead_flow_settings").select("sla_minutes").maybeSingle(),
    ctx.supabase.rpc("lead_timeline", { p_lead: l.id }),
    ctx.can("lead.assign") || ctx.can("lead.report") ? ctx.supabase.rpc("lead_agents") : Promise.resolve({ data: [] }),
  ]);
  const sla = settings?.sla_minutes ?? 5;
  // The clinic funnel's own status lines ("inquiry → contacted") stay in the audit trail; the call-center line is shown.
  const items = ((timeline ?? []) as Item[]).filter((i) => !(i.kind === "activity:status" && /^[a-z_]+ → [a-z_]+$/.test(i.body ?? "")));
  const people = (agents ?? []) as { user_id: string; full_name: string; is_agent: boolean; on_duty: boolean; open_leads: number }[];
  const owner = people.find((p) => p.user_id === l.assigned_to)?.full_name ?? (l.assigned_to === ctx.user.id ? (ar ? "أنت" : "You") : l.assigned_to ? "✓" : null);
  const canWork = !l.archived_at && (ctx.can("lead.write") || (ctx.can("lead.own") && l.assigned_to === ctx.user.id));
  const s = slaState(l.created_at, l.first_contact_at, sla);
  const alert = alertFor(l, sla);
  const lastIn = items.find((i) => i.kind.startsWith("message:") && i.direction === "in")?.at;
  const windowOpen = Boolean(lastIn && Date.now() - new Date(lastIn).getTime() < 24 * 3600_000);
  const back = `/os/calls/${l.id}`;

  return (
    <div className="gf">
      <AutoRefresh seconds={20} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/os/calls" className="text-gold-300 hover:underline">{ar ? "→ قائمة العمل" : "← Work queue"}</Link>
        {ctx.can("lead.read") && <Link href={`/os/leads/${l.id}`} className="text-ivory-300 hover:text-gold-100">{ar ? "حجز موعد فعلي في جدول العيادة" : "Book a real appointment in the clinic schedule"}</Link>}
      </div>
      <GfBanner ar={ar} error={searchParams.error} ok={searchParams.ok} />
      {l.archived_at && <p className="mb-4 rounded-lg border border-coal-500 bg-coal-800 px-4 py-3 text-sm">{ar ? "مؤرشف: " : "Archived: "}{l.archive_reason}</p>}

      <section className={`gf-card mb-4 p-5 ${alert === "urgent" ? "border-red-400/70" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-lg font-bold tracking-wider text-gold-300" data-lead-code>{l.code}</span>
          <CcPill status={l.cc_status} ar={ar} />
          {alert === "urgent" && <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-200 ring-1 ring-red-400/50">{ar ? `⚠ تجاوز ${sla} دقائق بدون تواصل` : `⚠ SLA BREACHED — over ${sla} min`}</span>}
          {alert === "followup_due" && <span className="rounded-md bg-orange-500/15 px-2 py-0.5 text-[11px] font-bold text-orange-200 ring-1 ring-orange-400/50">{ar ? "🟠 متابعة مستحقة" : "🟠 FOLLOW-UP DUE"}</span>}
          {alert === "replied" && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-200 ring-1 ring-sky-400/50">{ar ? "💬 العميل رد" : "💬 CUSTOMER REPLIED"}</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ivory-50">{l.full_name}</h1>
            <p className="num mt-1 text-base text-ivory-200">{l.phone}</p>
            {l.whatsapp_name && l.whatsapp_name !== l.full_name && <p className="gf-muted text-xs">{ar ? "اسم واتساب: " : "WhatsApp name: "}{l.whatsapp_name}</p>}
          </div>
          <div className="flex gap-2">
            <a href={telLink(l.phone)} className="gf-btn-gold px-5">📞 {ar ? "اتصال" : "Call"}</a>
            <a href={waLink(l.phone)} target="_blank" rel="noreferrer" className="gf-btn-ghost">💬 WhatsApp</a>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <div><dt className="gf-muted text-xs">{ar ? "الحملة" : "Campaign"}</dt><dd className="num font-semibold text-gold-100">{l.campaign?.code ?? (ar ? "بدون كود" : "No code")}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "المصدر" : "Source"}</dt><dd>{ar ? SOURCE[l.source]?.ar : SOURCE[l.source]?.en}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "وصل" : "Received"}</dt><dd>{dateTime(l.created_at, ctx.locale)}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "المسؤول" : "Owner"}</dt><dd className={owner ? "" : "font-semibold text-red-300"}>{owner ?? (ar ? "بدون مسؤول" : "Unassigned")}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "أول تواصل" : "First contact"}</dt><dd>{l.first_contact_at ? dateTime(l.first_contact_at, ctx.locale) : <span className="text-gold-100">{ar ? "ينتظر " : "Waiting "}<Since at={l.created_at} ar={ar} /></span>}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "زمن الرد" : "Response time"}</dt>
            <dd className={`num font-semibold ${s.state === "met" ? "text-emerald-300" : s.state === "waiting" ? "text-gold-100" : "text-red-300"}`}>
              {l.first_contact_at ? duration(s.seconds, ar) : "—"} {l.first_contact_at && (s.state === "met" ? "✓" : "✗")}
            </dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "المتابعة القادمة" : "Next follow-up"}</dt><dd>{l.next_follow_up_at ? <>{dateTime(l.next_follow_up_at, ctx.locale)}<span className="gf-muted block text-xs">{l.follow_up_reason}</span></> : "—"}</dd></div>
          <div><dt className="gf-muted text-xs">{ar ? "الحجز" : "Booking"}</dt><dd className={l.booking_at ? "text-emerald-300" : ""}>{l.booking_at ? <>{dateTime(l.booking_at, ctx.locale)}<span className="block text-xs">{l.booking_service}</span></> : "—"}</dd></div>
        </dl>
        {(l.ad_id || l.referral || l.utm_source) && (
          <div className="mt-4 rounded-lg bg-coal-900 px-3 py-2 text-xs text-ivory-300">
            {l.ad_id && <span className="me-4">{ar ? "الإعلان: " : "Ad: "}<span className="num text-ivory-100">{l.ad_name ?? l.ad_id}</span></span>}
            {l.adset_name && <span className="me-4">{ar ? "المجموعة: " : "Ad set: "}<span className="text-ivory-100">{l.adset_name}</span></span>}
            {l.meta_campaign_name && <span className="me-4">{ar ? "حملة ميتا: " : "Meta campaign: "}<span className="text-ivory-100">{l.meta_campaign_name}</span></span>}
            {l.referral?.headline && <span className="me-4">{ar ? "عنوان الإعلان: " : "Headline: "}<span className="text-ivory-100">{l.referral.headline}</span></span>}
            {l.utm_source && <span>UTM: <span className="num text-ivory-100">{[l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(" / ")}</span></span>}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          {canWork ? (
            <section className="gf-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-gold-100">{ar ? "الإجراء" : "Action"}</h2>
              <FullActions key={`${l.cc_status}-${l.last_action_at}`} id={l.id} ar={ar} back={back} current={l.cc_status} open={searchParams.open} defaultService={l.booking_service ?? l.campaign?.service_label} />
            </section>
          ) : !l.archived_at && (
            <p className="gf-card p-4 text-sm text-ivory-300">{ar ? "للعرض فقط — هذا العميل مسند لموظف آخر." : "View only — this lead is assigned to another agent."}</p>
          )}

          {canWork && (
            <section className="gf-card p-4">
              <h2 className="mb-3 text-sm font-semibold text-gold-100">{ar ? "رد واتساب من النظام" : "WhatsApp reply from the system"}</h2>
              {messagingMode() === "disabled" ? (
                <p className="text-xs text-ivory-300/70">{ar ? "إرسال واتساب غير مفعّل بعد (WHATSAPP_TOKEN). استخدم الاتصال أو زر واتساب." : "WhatsApp sending is not configured yet (WHATSAPP_TOKEN). Call, or use the WhatsApp button."}</p>
              ) : windowOpen ? (
                <form action={sendLeadReply} className="space-y-2">
                  <input type="hidden" name="id" value={l.id} />
                  <textarea name="body" required rows={3} maxLength={4000} className="gf-input" placeholder={ar ? "اكتب ردك… (يُسجَّل كأول تواصل)" : "Type your reply… (counts as first contact)"} />
                  <SubmitButton pendingLabel="…" className="gf-btn-gold w-full">{ar ? "إرسال" : "Send"}</SubmitButton>
                </form>
              ) : (
                <p className="text-xs text-ivory-300/70">{ar ? "نافذة الـ24 ساعة مغلقة — اتصل بالعميل." : "The 24-hour window is closed — call the customer."}</p>
              )}
            </section>
          )}

          {canWork && (
            <form action={addLeadNote} className="gf-card space-y-2 p-4">
              <input type="hidden" name="id" value={l.id} /><input type="hidden" name="back" value={back} />
              <label className="block"><span className="gf-label">{ar ? "ملاحظة" : "Note"}</span><textarea name="body" required rows={2} maxLength={2000} className="gf-input" /></label>
              <SubmitButton pendingLabel="…" className="gf-btn-ghost w-full">{ar ? "إضافة ملاحظة" : "Add note"}</SubmitButton>
            </form>
          )}

          {ctx.can("lead.assign") && !l.archived_at && (
            <section className="gf-card space-y-3 p-4">
              <h2 className="text-sm font-semibold text-gold-100">{ar ? "الإدارة" : "Admin"}</h2>
              <form action={assignLead} className="flex gap-2">
                <input type="hidden" name="id" value={l.id} /><input type="hidden" name="back" value={back} />
                <select name="user" defaultValue={l.assigned_to ?? ""} className="gf-input" aria-label={ar ? "المسؤول" : "Owner"}>
                  <option value="">{ar ? "— بدون مسؤول —" : "— Unassigned —"}</option>
                  {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}{p.is_agent ? (p.on_duty ? " ●" : " ○") : ""} ({p.open_leads})</option>)}
                </select>
                <SubmitButton pendingLabel="…" className="gf-btn-ghost">{ar ? "إسناد" : "Assign"}</SubmitButton>
              </form>
              <details data-form>
                <summary className="cursor-pointer text-xs text-ivory-300 hover:text-red-200">{ar ? "أرشفة (بدلًا من الحذف)" : "Archive (instead of delete)"}</summary>
                <form action={archiveLead} className="mt-2 flex gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <input name="reason" required minLength={3} maxLength={500} className="gf-input" placeholder={ar ? "السبب" : "Reason"} />
                  <SubmitButton pendingLabel="…" className="gf-btn-ghost" confirm={ar ? "أرشفة هذا العميل؟" : "Archive this lead?"}>{ar ? "أرشفة" : "Archive"}</SubmitButton>
                </form>
              </details>
            </section>
          )}
        </div>

        <section className="gf-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-gold-100">{ar ? "سجل المحادثة والإجراءات" : "Conversation & activity history"}</h2>
          <ol className="space-y-2">
            {items.map((i, n) => {
              const msg = i.kind.startsWith("message:") || i.kind === "assistant";
              const inbound = msg && i.direction === "in";
              return (
                <li key={n} className={`rounded-lg px-3 py-2 text-sm ${inbound ? "me-8 bg-coal-700" : msg ? "ms-8 bg-gold-500/15" : "border border-coal-600 text-xs text-ivory-300"}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ivory-300/70">
                    <span>{inbound ? (ar ? "العميل" : "Customer") : i.actor ?? (ar ? "النظام" : "System")}</span>
                    {!msg && <span className="rounded bg-coal-600 px-1.5">{i.kind.replace("activity:", "")}</span>}
                    {i.status && i.direction === "out" && <span>· {i.status}</span>}
                    <span className="ms-auto whitespace-nowrap">{dateTime(i.at, ctx.locale)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words">{i.body}</p>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}
