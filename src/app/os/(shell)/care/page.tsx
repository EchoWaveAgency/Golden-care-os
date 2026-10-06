import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { CARE_KIND, CARE_OUTCOME, CARE_STATUS, CATEGORY, SEVERITY, lbl, pick } from "@/lib/care/labels";
import { careSimulatorOn, voiceMode } from "@/lib/care/voice";
import { messagingMode } from "@/lib/messaging/provider";
import { llmEnabled } from "@/lib/care/llm";
import { patientNames } from "@/lib/care/people";
import { updateEscalation, simulateDue } from "@/app/actions/care";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type J = { id: string; ref: string; kind: string; status: string; outcome: string | null; channel: string; patient_id: string; scheduled_at: string;
  opened_at: string | null; last_inbound_at: string | null; closed_at: string | null; doctor: { full_name_ar: string; full_name_en: string | null } | null };
type E = { id: string; ref: string; severity: string; category: string; summary: string; patient_text: string | null; status: string; due_at: string; created_at: string;
  patient_id: string; journey_id: string | null; doctor: { full_name_ar: string; full_name_en: string | null } | null };

const TABS = [
  { key: "attention", statuses: ["human"] }, { key: "waiting", statuses: ["waiting"] }, { key: "scheduled", statuses: ["scheduled"] },
  { key: "closed", statuses: ["completed", "no_response", "cancelled", "failed", "opted_out"] },
];
const SEV_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export default async function CarePage({ searchParams }: { searchParams: { tab?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("care.read", "care.settings", "clinical.write.own");
  const ar = ctx.locale === "ar";
  const tab = TABS.find((t) => t.key === searchParams.tab) ?? TABS[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const weekAgo = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() - 6 * 86400_000));
  const canKpi = ctx.can("care.read") || ctx.can("care.settings");
  const [{ data: rows }, { data: escs }, { data: settings }, kpiRes] = await Promise.all([
    ctx.supabase.from("care_journeys").select("id, ref, kind, status, outcome, channel, patient_id, scheduled_at, opened_at, last_inbound_at, closed_at, doctor:staff(full_name_ar, full_name_en)")
      .in("status", tab.statuses).order(tab.key === "closed" ? "closed_at" : "scheduled_at", { ascending: tab.key !== "closed" }).limit(100).returns<J[]>(),
    ctx.supabase.from("care_escalations").select("id, ref, severity, category, summary, patient_text, status, due_at, created_at, patient_id, journey_id, doctor:staff(full_name_ar, full_name_en)")
      .neq("status", "resolved").order("due_at").limit(100).returns<E[]>(),
    ctx.supabase.from("care_agent_settings").select("enabled, voice_enabled").eq("branch_id", ctx.branchId ?? "").maybeSingle(),
    canKpi && ctx.branchId ? ctx.supabase.rpc("care_kpis", { p_branch: ctx.branchId, p_from: weekAgo, p_to: today }) : Promise.resolve({ data: null }),
  ]);
  const k = (kpiRes.data ?? {}) as Record<string, number | null>;
  const escalations = (escs ?? []).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.due_at.localeCompare(b.due_at));
  const ids = Array.from(new Set([...(rows ?? []).map((r) => r.patient_id), ...escalations.map((e) => e.patient_id)]));
  const names = await patientNames(ctx, ids);
  const pct = (a?: number | null, b?: number | null) => (b ? `${Math.round((Number(a ?? 0) / Number(b)) * 100)}%` : "—");
  const now = Date.now();
  const tabName = (key: string) => ({ attention: ar ? "تحتاج تدخل" : "Needs attention", waiting: ar ? "بانتظار الرد" : "Waiting", scheduled: ar ? "مجدولة" : "Scheduled", closed: ar ? "مغلقة" : "Closed" }[key] ?? key);
  const ok = searchParams.ok?.startsWith("run_") ? (ar ? `تم التشغيل: فُتحت ${searchParams.ok.slice(4)} محادثة.` : `Run done: ${searchParams.ok.slice(4)} opened.`)
    : { resolved: ar ? "تم إغلاق التنبيه." : "Escalation resolved.", acknowledged: ar ? "تم استلام التنبيه." : "Escalation acknowledged." }[searchParams.ok ?? ""];
  const mode = messagingMode();

  return (
    <>
      <PageHeader title={ar ? "مساعد المتابعة مع المرضى" : "Patient care assistant"}
        subtitle={ar ? "يؤكد الحجوزات، يذكّر بالمواعيد، ويطمّن على المرضى بعد الزيارة. أي شيء طبي يُحوَّل لكم فورًا." : "Confirms bookings, reminds patients, and checks on them after the visit. Anything clinical comes straight to you."}
        actions={ctx.can("care.settings") ? <Link href="/os/care/settings" className="btn-ghost">{ar ? "الإعدادات" : "Settings"}</Link> : undefined} />
      <Banner error={searchParams.error} success={ok} />
      {!settings?.enabled && ctx.can("care.settings") && (
        <p className="mb-4 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-navy-700">{ar ? "المساعد متوقف في هذا الفرع. شغّله من الإعدادات." : "The assistant is off for this branch. Turn it on in Settings."}</p>)}
      <p className="mb-4 text-xs text-ink-500" data-care-mode>
        {ar ? "واتساب: " : "WhatsApp: "}{mode === "whatsapp" ? (ar ? "متصل" : "connected") : mode === "dev" ? (ar ? "وضع التطوير (لا يُرسل فعليًا)" : "development mode (not sent)") : (ar ? "غير متصل" : "not connected")}
        {" · "}{ar ? "المكالمات: " : "Calls: "}{voiceMode() === "twilio" ? (ar ? "متصل" : "connected") : voiceMode() === "dev" ? (ar ? "محاكاة" : "simulated") : (ar ? "غير متصل" : "not connected")}
        {" · "}{ar ? "فهم الردود الحرة بالذكاء الاصطناعي: " : "AI understanding of free text: "}{llmEnabled() ? (ar ? "مفعّل" : "on") : (ar ? "قواعد فقط" : "rules only")}
      </p>

      {canKpi && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-care-kpis>
          <Stat label={ar ? "محادثات آخر ٧ أيام" : "Conversations (7 days)"} value={k.opened ?? 0} />
          <Stat label={ar ? "نسبة الرد" : "Reply rate"} value={pct(k.replied, k.opened)} tone="teal" />
          <Stat label={ar ? "أكدوا الحضور" : "Confirmed"} value={`${k.confirmed ?? 0} / ${k.booking_total ?? 0}`} tone="teal" />
          <Stat label={ar ? "ملتزمون بالعلاج" : "Taking treatment"} value={pct(k.meds_yes, k.meds_answered)} />
          <Stat label={ar ? "متوسط التقييم" : "Average rating"} value={k.avg_rating ?? "—"} tone="gold" />
        </div>)}

      <section className="mb-6" data-escalations>
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "تنبيهات تحتاج متابعة" : "Escalations to handle"} <span className="num text-ink-500">({escalations.length})</span></h2>
        {escalations.length === 0 ? <p className="card p-4 text-sm text-ink-300">{ctx.t("common.none")}</p> : (
          <ul className="space-y-2">
            {escalations.map((e) => {
              const late = new Date(e.due_at).getTime() < now;
              return (
                <li key={e.id} className={`card p-4 text-sm ${e.severity === "urgent" ? "border-danger/50 bg-danger/5" : ""}`} data-escalation={e.severity}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p><span className={`rounded-full px-2 py-0.5 text-xs ${e.severity === "urgent" ? "bg-danger text-white" : e.severity === "high" ? "bg-gold-100 text-navy-700" : "bg-ivory-200 text-ink-700"}`}>{lbl(SEVERITY, e.severity, ar)}</span>
                        {" "}<span className="font-medium">{names.get(e.patient_id)?.name ?? ""}</span> · {lbl(CATEGORY, e.category, ar)} · <span className="num text-ink-500">{e.ref}</span></p>
                      <p className="mt-1">{pick(e.summary, ar)}</p>
                      {e.patient_text && <p className="mt-1 rounded-lg bg-ivory-100 px-3 py-2 text-ink-700">«{e.patient_text}»</p>}
                      <p className="mt-1 text-xs text-ink-500">{names.get(e.patient_id)?.phone ? <span className="num" dir="ltr">{names.get(e.patient_id)?.phone}</span> : null}
                        {e.doctor ? ` · ${ar ? e.doctor.full_name_ar : e.doctor.full_name_en ?? e.doctor.full_name_ar}` : ""}
                        {" · "}<span className={late ? "font-medium text-danger" : ""}>{ar ? "مطلوب قبل " : "due "}{dateTime(e.due_at, ctx.locale)}</span>
                        {e.status === "acknowledged" ? ` · ${ar ? "قيد المتابعة" : "in progress"}` : ""}
                        {e.journey_id ? <> · <Link href={`/os/care/${e.journey_id}`} className="text-teal-700 hover:underline">{ar ? "المحادثة" : "conversation"}</Link></> : null}</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {e.status === "open" && (
                        <form action={updateEscalation}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="acknowledge" />
                          <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "استلمت" : "Acknowledge"}</SubmitButton></form>)}
                      <form action={updateEscalation} className="flex items-end gap-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="resolve" />
                        <input name="note" required placeholder={ar ? "ماذا تم؟" : "What was done?"} className="input w-48 py-1 text-xs" />
                        <SubmitButton pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "تم التعامل" : "Resolve"}</SubmitButton></form>
                    </div>
                  </div>
                </li>);
            })}
          </ul>)}
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-2 text-sm">
          {TABS.map((t) => <Link key={t.key} href={`/os/care?tab=${t.key}`} className={`rounded-full px-3 py-1 ${t.key === tab.key ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50"}`}>{tabName(t.key)}</Link>)}
        </nav>
        {careSimulatorOn() && ctx.can("care.manage") && (
          <form action={simulateDue} data-care-run><SubmitButton pendingLabel="…" className="btn-ghost px-3 py-1 text-xs">{ar ? "تشغيل المستحق الآن (محاكاة)" : "Run due now (simulator)"}</SubmitButton></form>)}
      </div>
      <ul className="card divide-y divide-ivory-200 text-sm" data-journeys>
        {(rows ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <Link href={`/os/care/${r.id}`} className="text-navy-700 hover:underline" data-journey={r.kind}>
              <span className="font-medium">{names.get(r.patient_id)?.name ?? ""}</span> · {lbl(CARE_KIND, r.kind, ar)}
              <span className="block text-xs text-ink-300"><span className="num">{r.ref}</span> · {r.channel === "voice" ? (ar ? "مكالمة" : "call") : "WhatsApp"}
                {r.doctor ? ` · ${ar ? r.doctor.full_name_ar : r.doctor.full_name_en ?? r.doctor.full_name_ar}` : ""}</span></Link>
            <span className="text-end text-xs"><span className="block">{lbl(CARE_STATUS, r.status, ar)}{r.outcome ? ` · ${lbl(CARE_OUTCOME, r.outcome, ar)}` : ""}</span>
              <span className="text-ink-500">{dateTime(r.closed_at ?? r.last_inbound_at ?? r.opened_at ?? r.scheduled_at, ctx.locale)}</span></span>
          </li>))}
      </ul>
    </>
  );
}
