import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { ANSWER, CARE_KIND, CARE_OUTCOME, CARE_STATUS, CATEGORY, SEVERITY, lbl, pick } from "@/lib/care/labels";
import { careSimulatorOn } from "@/lib/care/voice";
import { patientNames } from "@/lib/care/people";
import { closeJourney, resumeAgent, simulateReply, staffReply, takeOver, updateEscalation } from "@/app/actions/care";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type J = { id: string; ref: string; kind: string; status: string; state: string; outcome: string | null; channel: string; lang: string; patient_id: string;
  data: Record<string, string | number | boolean | null>; scheduled_at: string; opened_at: string | null; last_inbound_at: string | null; closed_at: string | null;
  appointment_id: string | null; encounter_id: string | null; doctor: { full_name_ar: string; full_name_en: string | null } | null };
type M = { id: string; direction: string; author: string; body: string; status: string; intent: string | null; template_code: string | null; created_at: string; channel: string };
type E = { id: string; ref: string; severity: string; category: string; summary: string; status: string; resolution: string | null; due_at: string };

export default async function CareJourneyPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("care.read", "clinical.write.own");
  const ar = ctx.locale === "ar";
  const [{ data: j }, { data: msgs }, { data: escs }] = await Promise.all([
    ctx.supabase.from("care_journeys").select("id, ref, kind, status, state, outcome, channel, lang, patient_id, data, scheduled_at, opened_at, last_inbound_at, closed_at, appointment_id, encounter_id, doctor:staff(full_name_ar, full_name_en)")
      .eq("id", params.id).maybeSingle<J>(),
    ctx.supabase.from("care_messages").select("id, direction, author, body, status, intent, template_code, created_at, channel").eq("journey_id", params.id).order("created_at").returns<M[]>(),
    ctx.supabase.from("care_escalations").select("id, ref, severity, category, summary, status, resolution, due_at").eq("journey_id", params.id).order("created_at").returns<E[]>(),
  ]);
  if (!j) notFound();
  const who = (await patientNames(ctx, [j.patient_id])).get(j.patient_id);
  const manage = ctx.can("care.manage");
  const open = ["scheduled", "waiting", "human"].includes(j.status);
  const inWindow = j.channel === "whatsapp" && j.last_inbound_at && Date.now() - new Date(j.last_inbound_at).getTime() < 24 * 3600_000;
  const d = j.data ?? {};
  const answers: [string, string][] = [];
  if (d.meds) answers.push([ar ? "العلاج" : "Treatment", lbl(ANSWER, String(d.meds), ar) + (d.meds_why ? ` (${lbl(ANSWER, String(d.meds_why), ar)})` : "")]);
  if (d.improve) answers.push([ar ? "التحسن" : "Improvement", lbl(ANSWER, String(d.improve), ar)]);
  if (d.problems) answers.push([ar ? "ملاحظات المريض" : "Patient's notes", String(d.problems)]);
  if (d.rating) answers.push([ar ? "التقييم" : "Rating", `${d.rating} / 5`]);
  if (d.followup_offer) answers.push([ar ? "حجز المتابعة" : "Follow-up booking", d.followup_offer === "yes" ? (ar ? "طلب الحجز" : "asked us to book") : (ar ? "سيحجز بنفسه" : "will book")]);
  if (d.followup_why) answers.push([ar ? "سبب عدم المتابعة" : "Reason for no follow-up", String(d.followup_why)]);
  if (d.staff_note) answers.push([ar ? "ملاحظة الموظف" : "Staff note", String(d.staff_note)]);
  const ok = { taken: ar ? "المحادثة معك الآن؛ المساعد متوقف فيها." : "You have the conversation; the assistant is paused.", resumed: ar ? "رجعت المحادثة للمساعد." : "Handed back to the assistant.",
    closed: ar ? "تم إغلاق المحادثة." : "Conversation closed.", sent: ar ? "تم إرسال ردك." : "Reply sent.", resolved: ar ? "تم إغلاق التنبيه." : "Escalation resolved.", acknowledged: ar ? "تم الاستلام." : "Acknowledged." }[searchParams.ok ?? ""];

  return (
    <>
      <PageHeader title={`${who?.name ?? ""} · ${lbl(CARE_KIND, j.kind, ar)}`}
        subtitle={`${j.ref} · ${j.channel === "voice" ? (ar ? "مكالمة" : "call") : "WhatsApp"} · ${lbl(CARE_STATUS, j.status, ar)}${j.outcome ? ` · ${lbl(CARE_OUTCOME, j.outcome, ar)}` : ""}${j.doctor ? ` · ${ar ? j.doctor.full_name_ar : j.doctor.full_name_en ?? j.doctor.full_name_ar}` : ""}`}
        actions={<div className="flex gap-2">{ctx.can("patient.read") && <Link href={`/os/patients/${j.patient_id}`} className="btn-ghost">{ar ? "ملف المريض" : "Patient file"}</Link>}
          <Link href="/os/care" className="btn-ghost">{ar ? "كل المحادثات" : "All conversations"}</Link></div>} />
      <Banner error={searchParams.error} success={ok} />
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="card space-y-3 p-4" data-thread>
            {(msgs ?? []).length === 0 && <p className="text-sm text-ink-300">{ar ? `لم تبدأ بعد — موعدها ${dateTime(j.scheduled_at, ctx.locale)}` : `Not started — planned for ${dateTime(j.scheduled_at, ctx.locale)}`}</p>}
            {(msgs ?? []).map((m) => (
              <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`} data-msg={m.direction}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.direction === "in" ? "bg-ivory-100 text-ink-900" : m.author === "staff" ? "bg-gold-100 text-navy-800" : "bg-teal-700 text-white"}`}>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <p className={`mt-1 text-[11px] ${m.direction === "in" ? "text-ink-500" : m.author === "staff" ? "text-ink-500" : "text-teal-100"}`}>
                    {m.direction === "in" ? (ar ? "المريض" : "Patient") : m.author === "staff" ? (ar ? "موظف" : "Staff") : (ar ? "المساعد" : "Assistant")}
                    {" · "}{dateTime(m.created_at, ctx.locale, { dateStyle: undefined })}{m.intent ? ` · ${m.intent}` : ""}
                    {m.direction === "out" && m.status !== "logged" ? ` · ${m.status}` : ""}{m.template_code ? (ar ? " · قالب معتمد" : " · approved template") : ""}</p>
                </div>
              </div>))}
          </div>
          {manage && inWindow && (
            <form key={`reply-${(msgs ?? []).length}`} action={staffReply} className="card mt-3 flex flex-wrap items-end gap-2 p-4">
              <input type="hidden" name="journey_id" value={j.id} />
              <label className="flex-1"><span className="label">{ar ? "رد من فريق العمل (واتساب، خلال ٢٤ ساعة من آخر رسالة للمريض)" : "Staff reply (WhatsApp, within 24 hours of the patient's last message)"}</span>
                <textarea name="body" required rows={2} className="input" /></label>
              <SubmitButton pendingLabel="…">{ar ? "إرسال" : "Send"}</SubmitButton>
            </form>)}
          {careSimulatorOn() && manage && open && (
            <form key={`sim-${(msgs ?? []).length}`} action={simulateReply} className="mt-3 rounded-xl border border-dashed border-teal-300 bg-teal-50/50 p-4" data-simulator>
              <input type="hidden" name="journey_id" value={j.id} />
              <p className="mb-2 text-xs text-teal-800">{ar ? "محاكي محلي — اكتب كأنك المريض (لا يظهر في التشغيل الفعلي)." : "Local simulator — reply as the patient (not available in production)."}</p>
              {j.channel === "voice" && j.state === "dialing" ? (
                <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "المريض رد على المكالمة" : "Patient answers the call"}</SubmitButton>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <input name="text" className="input flex-1" placeholder={ar ? "رد المريض…" : "Patient reply…"} data-sim-text />
                  <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إرسال كمريض" : "Send as patient"}</SubmitButton>
                </div>)}
            </form>)}
        </section>
        <aside className="space-y-4">
          {answers.length > 0 && (
            <div className="card p-4 text-sm" data-answers>
              <h2 className="mb-2 font-medium text-navy-700">{ar ? "ملخص الردود" : "Answers"}</h2>
              <dl className="space-y-1">{answers.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-ink-500">{k}</dt><dd className="text-end">{v}</dd></div>)}</dl>
            </div>)}
          {(escs ?? []).length > 0 && (
            <div className="card p-4 text-sm">
              <h2 className="mb-2 font-medium text-navy-700">{ar ? "التنبيهات" : "Escalations"}</h2>
              <ul className="space-y-3">{(escs ?? []).map((e) => (
                <li key={e.id}>
                  <p><span className={e.severity === "urgent" ? "font-medium text-danger" : ""}>{lbl(SEVERITY, e.severity, ar)}</span> · {lbl(CATEGORY, e.category, ar)} · <span className="num text-ink-500">{e.ref}</span></p>
                  <p className="text-ink-700">{pick(e.summary, ar)}</p>
                  {e.status === "resolved" ? <p className="text-xs text-teal-700">{ar ? "تم: " : "Done: "}{e.resolution}</p> : (
                    <form action={updateEscalation} className="mt-1 flex items-end gap-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="action" value="resolve" />
                      <input type="hidden" name="back" value={`/os/care/${j.id}`} />
                      <input name="note" required placeholder={ar ? "ماذا تم؟" : "What was done?"} className="input py-1 text-xs" />
                      <SubmitButton pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "تم" : "Resolve"}</SubmitButton></form>)}
                </li>))}</ul>
            </div>)}
          {manage && open && (
            <div className="card space-y-3 p-4 text-sm">
              {j.status !== "human" ? (
                <form action={takeOver}><input type="hidden" name="journey_id" value={j.id} />
                  <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "أتولى المحادثة بنفسي" : "Take over the conversation"}</SubmitButton></form>
              ) : (
                <form action={resumeAgent}><input type="hidden" name="journey_id" value={j.id} />
                  <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "إرجاعها للمساعد" : "Hand back to the assistant"}</SubmitButton></form>)}
              <form action={closeJourney} className="space-y-2"><input type="hidden" name="journey_id" value={j.id} />
                <input name="note" required placeholder={ar ? "سبب الإغلاق / ما تم" : "Reason / what was done"} className="input" />
                <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "إغلاق المحادثة" : "Close the conversation"}</SubmitButton></form>
            </div>)}
          <p className="text-xs text-ink-500">{ar ? "المساعد آلي ويعرّف نفسه بذلك، لا يقدم نصيحة طبية، ويحوّل أي شيء طبي للفريق. علامات الخطر توقفه فورًا وتفتح تنبيهًا عاجلًا." : "The assistant is automated and says so, gives no medical advice, and passes anything clinical to the team. Danger signs stop it and open an urgent escalation."}</p>
        </aside>
      </div>
    </>
  );
}
