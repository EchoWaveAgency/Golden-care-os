import { requireAny } from "@/lib/session";
import { saveCareSettings } from "@/app/actions/care";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

type S = { enabled: boolean; booking_confirm: boolean; pre_visit: boolean; post_visit: boolean; followup: boolean; voice_enabled: boolean; voice_fallback: boolean;
  contact_from: string; contact_to: string; confirm_delay_min: number; confirm_min_lead_hours: number; post_visit_delay_hours: number; followup_lead_days: number;
  nudge_after_hours: number; max_nudges: number; clinic_phone: string | null };

const DEFAULTS: S = { enabled: false, booking_confirm: true, pre_visit: true, post_visit: true, followup: true, voice_enabled: false, voice_fallback: true,
  contact_from: "10:00", contact_to: "21:00", confirm_delay_min: 5, confirm_min_lead_hours: 3, post_visit_delay_hours: 20, followup_lead_days: 2,
  nudge_after_hours: 4, max_nudges: 1, clinic_phone: null };

export default async function CareSettingsPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("care.settings");
  const ar = ctx.locale === "ar";
  const { data } = await ctx.supabase.from("care_agent_settings").select("*").eq("branch_id", ctx.branchId ?? "").maybeSingle<S>();
  const s = { ...DEFAULTS, ...(data ?? {}) };
  const t = (v: string) => v.slice(0, 5);
  const box = (name: keyof S, label: string, hint?: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-ivory-200 p-3">
      <input type="checkbox" name={name} defaultChecked={Boolean(s[name])} className="mt-1" data-setting={name} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-ink-500">{hint}</span>}</span>
    </label>);
  const num = (name: keyof S, label: string, min: number, max: number) => (
    <label><span className="label">{label}</span><input name={name} type="number" min={min} max={max} defaultValue={String(s[name])} className="input num" data-setting={name} /></label>);

  return (
    <>
      <PageHeader title={ar ? "إعدادات مساعد المتابعة" : "Care assistant settings"}
        subtitle={ar ? "لكل فرع على حدة. المساعد لا يتواصل مع مريض رفض رسائل واتساب أو المتابعة." : "Per branch. The assistant never contacts a patient who refused WhatsApp messages or follow-ups."} />
      <Banner error={searchParams.error} success={searchParams.ok === "saved" ? (ar ? "تم حفظ الإعدادات." : "Settings saved.") : undefined} />
      <form action={saveCareSettings} className="card space-y-5 p-5 text-sm">
        {box("enabled", ar ? "تشغيل المساعد في هذا الفرع" : "Turn the assistant on for this branch")}
        <div className="grid gap-3 md:grid-cols-2">
          {box("booking_confirm", ar ? "تأكيد الحجز بعد الحجز مباشرة" : "Confirm new bookings")}
          {box("pre_visit", ar ? "تذكير قبل الموعد بيوم" : "Day-before reminder", ar ? "يحل محل رسالة التذكير العادية." : "Replaces the plain reminder message.")}
          {box("post_visit", ar ? "متابعة بعد الزيارة" : "After-visit follow-up", ar ? "العلاج، التحسن، أي مشكلة، والتقييم." : "Treatment, improvement, problems, rating.")}
          {box("followup", ar ? "تذكير بموعد المتابعة اللي طلبه الطبيب" : "Remind about the follow-up the doctor asked for")}
          {box("voice_enabled", ar ? "مكالمات صوتية" : "Voice calls", ar ? "يتطلب ربط مزود اتصالات. المرضى اللي بيفضلوا المكالمة يتكلموا بالتليفون." : "Needs a telephony provider. Patients who prefer calls are phoned.")}
          {box("voice_fallback", ar ? "اتصال لو مفيش رد على واتساب" : "Call when WhatsApp gets no reply")}
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label><span className="label">{ar ? "التواصل من الساعة" : "Contact from"}</span><input name="contact_from" type="time" defaultValue={t(s.contact_from)} className="input" data-setting="contact_from" /></label>
          <label><span className="label">{ar ? "حتى الساعة" : "Until"}</span><input name="contact_to" type="time" defaultValue={t(s.contact_to)} className="input" data-setting="contact_to" /></label>
          {num("confirm_delay_min", ar ? "تأكيد الحجز بعد (دقيقة)" : "Confirm after (minutes)", 0, 1440)}
          {num("confirm_min_lead_hours", ar ? "لا تأكيد لو الموعد خلال (ساعة)" : "Skip if visit within (hours)", 0, 72)}
          {num("post_visit_delay_hours", ar ? "المتابعة بعد الزيارة بـ (ساعة)" : "Follow up after (hours)", 0, 168)}
          {num("followup_lead_days", ar ? "تذكير المتابعة قبلها بـ (يوم)" : "Follow-up reminder (days before)", 0, 30)}
          {num("nudge_after_hours", ar ? "تذكير لو مفيش رد بعد (ساعة)" : "Nudge after (hours)", 1, 48)}
          {num("max_nudges", ar ? "عدد مرات التذكير" : "Number of nudges", 0, 3)}
        </div>
        <label className="block md:w-1/3"><span className="label">{ar ? "رقم العيادة اللي يظهر للمريض" : "Clinic number shown to patients"}</span>
          <input name="clinic_phone" defaultValue={s.clinic_phone ?? ""} className="input" dir="ltr" data-setting="clinic_phone" /></label>
        <p className="text-xs text-ink-500">{ar ? "رسائل البداية في واتساب لازم تكون قوالب معتمدة من Meta (gc_care_booking_confirm، gc_care_pre_visit، gc_care_post_visit، gc_care_followup، gc_care_nudge). صياغة الرسائل يعتمدها المدير الطبي وخدمة العملاء." : "WhatsApp opening messages must be Meta-approved templates (gc_care_booking_confirm, gc_care_pre_visit, gc_care_post_visit, gc_care_followup, gc_care_nudge). Wording to be signed off by the medical director and patient relations."}</p>
        <SubmitButton pendingLabel="…">{ar ? "حفظ" : "Save"}</SubmitButton>
      </form>
    </>
  );
}
