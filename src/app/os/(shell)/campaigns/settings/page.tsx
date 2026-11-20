import Link from "next/link";
import { headers } from "next/headers";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { GfBanner, GfHeader } from "@/components/gf/Frame";
import { Since } from "@/components/gf/Live";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCampaign, saveGrowthDepartment, saveGrowthSettings, saveLeadSettings, setDuty } from "@/app/actions/lead-flow";

export const metadata = { title: "Campaigns settings" };
export const dynamic = "force-dynamic";

type Campaign = { id: string; code: string; name_ar: string; name_en: string; service_label: string | null; keywords: string[]; meta_ad_ids: string[];
  is_active: boolean; starts_on: string | null; ends_on: string | null; growth_department: string | null; always_on: boolean };
type Dept = { code: string; name_ar: string; name_en: string; baseline_month: number; target_p1: number; target_p2: number; target_p3: number };
type GSet = { phase1_start: string | null; phase_weeks: number; booking_rate: number; show_rate: number; new_lead_share: number };

export default async function GoldenSettings({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("lead.campaigns", "lead.assign");
  const ar = ctx.locale === "ar";
  const [{ data: camps }, { data: settings }, { data: people }, { data: last }, { data: depts }, { data: gs }] = await Promise.all([
    ctx.supabase.from("lead_campaigns").select("*").order("is_active", { ascending: false }).order("always_on").order("code").returns<Campaign[]>(),
    ctx.supabase.from("lead_flow_settings").select("code_prefix, sla_minutes, auto_assign, updated_at").maybeSingle(),
    ctx.supabase.rpc("lead_agents"),
    ctx.supabase.from("lead_messages").select("received_at").eq("direction", "in").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.from("growth_departments").select("code, name_ar, name_en, baseline_month, target_p1, target_p2, target_p3").eq("is_active", true).order("sort_order").returns<Dept[]>(),
    ctx.supabase.from("growth_settings").select("phase1_start, phase_weeks, booking_rate, show_rate, new_lead_share").maybeSingle<GSet>(),
  ]);
  const staff = (people ?? []) as { user_id: string; full_name: string; is_agent: boolean; on_duty: boolean; open_leads: number; new_leads: number }[];
  const canEdit = ctx.can("lead.campaigns");
  const h = headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const env = (k: string) => Boolean(process.env[k]);
  const checks: [string, boolean, string, string][] = [
    ["WHATSAPP_APP_SECRET", env("WHATSAPP_APP_SECRET"), "توقيع ميتا للتحقق من الرسائل (إلزامي)", "Meta signature check for incoming messages (required)"],
    ["WHATSAPP_VERIFY_TOKEN", env("WHATSAPP_VERIFY_TOKEN"), "رمز التحقق عند تسجيل الـWebhook (إلزامي)", "Verify token for webhook registration (required)"],
    ["SUPABASE_SERVICE_ROLE_KEY", env("SUPABASE_SERVICE_ROLE_KEY"), "حفظ الرسائل من الـWebhook (إلزامي)", "Stores webhook messages (required)"],
    ["WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID", env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID"), "الرد من النظام والردود الآلية", "Replies from the system and auto-acknowledgement"],
    ["CRON_SECRET", env("CRON_SECRET"), "المهام الدورية (أسماء الإعلانات، شبكة الأمان)", "Scheduled job (ad names, safety sweep)"],
    ["META_ADS_TOKEN", env("META_ADS_TOKEN"), "أسماء الإعلان / المجموعة / الحملة (اختياري)", "Ad / ad set / campaign names (optional)"],
  ];

  return (
    <div className="gf">
      <GfHeader ar={ar} title={ar ? "الحملات والإعدادات" : "Campaigns & settings"} actions={<Link href="/os/campaigns" className="gf-btn-ghost">{ar ? "لوحة التحكم" : "Control"}</Link>} />
      <GfBanner ar={ar} error={searchParams.error} ok={searchParams.ok} />

      <section className="gf-card mb-5 p-4" data-integration>
        <h2 className="mb-1 text-sm font-semibold text-gold-100">{ar ? "ربط واتساب (WhatsApp Cloud API)" : "WhatsApp Cloud API connection"}</h2>
        <p className="mb-3 text-xs text-ivory-300/70">
          {ar ? "رابط الـWebhook الذي يُسجَّل في Meta (حقل messages):" : "Webhook URL to register in Meta (messages field):"}{" "}
          <code className="num rounded bg-coal-900 px-2 py-1 text-gold-100">{origin}/api/webhooks/whatsapp</code>
        </p>
        <ul className="grid gap-1.5 text-sm md:grid-cols-2">
          {checks.map(([k, ok, a, e]) => (
            <li key={k} className="flex items-start gap-2">
              <span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "✓" : "✗"}</span>
              <span><code className="num text-xs text-ivory-100">{k}</code> <span className="text-xs text-ivory-300/70">— {ar ? a : e}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ivory-300/80">
          {ar ? "آخر رسالة واتساب وصلت النظام: " : "Last WhatsApp message received: "}
          {last?.received_at ? <><span className="text-gold-100">{dateTime(last.received_at, ctx.locale)}</span> ({ar ? "منذ " : ""}<Since at={last.received_at} ar={ar} />{ar ? "" : " ago"})</> : <span className="text-red-300">{ar ? "لم تصل أي رسالة بعد" : "none yet"}</span>}
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <form action={saveLeadSettings} className="gf-card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-gold-100">{ar ? "قواعد التشغيل" : "Operating rules"}</h2>
            <div className="grid grid-cols-2 gap-3">
              <label><span className="gf-label">{ar ? "بادئة رقم العميل" : "Lead id prefix"}</span>
                <input name="code_prefix" defaultValue={settings?.code_prefix} pattern="[A-Za-z0-9]{2,8}" className="gf-input num" disabled={!canEdit} /></label>
              <label><span className="gf-label">{ar ? "هدف أول رد (دقائق)" : "First response target (min)"}</span>
                <input name="sla_minutes" type="number" min={1} max={240} defaultValue={settings?.sla_minutes} className="gf-input num" disabled={!canEdit} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto_assign" defaultChecked={settings?.auto_assign} disabled={!canEdit} />
              {ar ? "إسناد تلقائي بالتناوب لموظفي الوردية" : "Auto-assign round-robin to agents on duty"}</label>
            {canEdit && <SubmitButton pendingLabel="…" className="gf-btn-gold">{ar ? "حفظ" : "Save"}</SubmitButton>}
          </form>

          <section className="gf-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-gold-100">{ar ? "موظفو الكول سنتر" : "Call center agents"}</h2>
            {staff.length === 0 ? (
              <p className="text-xs text-ivory-300/70">{ar ? "لا يوجد موظفون. أضف مستخدمًا بدور «موظف الكول سنتر» من صفحة المستخدمين والصلاحيات." : "No agents yet. Give users the “Call Center Agent” role in Users & permissions."}</p>
            ) : (
              <ul className="divide-y divide-coal-600">
                {staff.map((s) => (
                  <li key={s.user_id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1">{s.full_name}<span className="gf-muted block text-[11px]">{s.is_agent ? (ar ? "موظف كول سنتر" : "Agent") : (ar ? "مشرف" : "Supervisor")} · {s.open_leads} {ar ? "مفتوح" : "open"} · {s.new_leads} {ar ? "جديد" : "new"}</span></span>
                    {s.is_agent && ctx.can("lead.assign") && (
                      <form action={setDuty}>
                        <input type="hidden" name="user" value={s.user_id} /><input type="hidden" name="on" value={s.on_duty ? "0" : "1"} /><input type="hidden" name="back" value="/os/campaigns/settings" />
                        <SubmitButton pendingLabel="…" className={`gf-btn min-h-0 px-3 py-1.5 text-xs ${s.on_duty ? "bg-emerald-500 text-coal-950" : "border border-coal-500 text-ivory-300"}`}>
                          {s.on_duty ? (ar ? "● في الوردية" : "● On duty") : (ar ? "○ خارج الوردية" : "○ Off duty")}
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gold-100">{ar ? "أكواد الحملات" : "Campaign codes"}</h2>
          <p className="text-xs text-ivory-300/70">
            {ar ? "ضع الكود في الرسالة الجاهزة لإعلان Click-to-WhatsApp (مثال: «SUMMER27-LASER — أريد تفاصيل عرض الليزر»). الترتيب: الكود في الرسالة ← رقم الإعلان ← الكلمات المفتاحية لحملة نشطة (الموسمية قبل الدائمة) ← اسم حملة ميتا. الحملات الدائمة تستقبل العملاء طول السنة، والحملة الموسمية (بتواريخ) تأخذ الأولوية طول مدتها."
                : "Put the code in the Click-to-WhatsApp ad's pre-filled message (e.g. “SUMMER27-LASER — I want the laser offer”). Order: code in the message → ad id → keywords of a live campaign (seasonal before always-on) → Meta campaign name. Always-on campaigns receive leads all year; a seasonal campaign (with dates) takes over while it runs."}
          </p>
          {(camps ?? []).map((c) => <CampaignForm key={c.id} c={c} ar={ar} canEdit={canEdit} depts={depts ?? []} />)}
          {canEdit && <CampaignForm ar={ar} canEdit depts={depts ?? []} />}
        </section>
      </div>

      {gs && <GrowthForms ar={ar} canEdit={canEdit} gs={gs} depts={depts ?? []} />}
    </div>
  );
}

const pctIn = (n: number) => String(Math.round(n * 1000) / 10);

function GrowthForms({ ar, canEdit, gs, depts }: { ar: boolean; canEdit: boolean; gs: GSet; depts: Dept[] }) {
  return (
    <section id="growth" className="mt-6 space-y-4">
      <h2 className="text-sm font-semibold text-gold-100">{ar ? "أهداف الأقسام (خطة النمو)" : "Department targets (growth plan)"}</h2>
      <form action={saveGrowthSettings} className="gf-card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <label><span className="gf-label">{ar ? "بداية المرحلة الأولى" : "Phase 1 start"}</span><input type="date" name="phase1_start" defaultValue={gs.phase1_start ?? ""} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "أسابيع كل مرحلة" : "Weeks per phase"}</span><input type="number" name="phase_weeks" min={1} max={52} defaultValue={gs.phase_weeks} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "نسبة الحجز من العملاء %" : "Lead → booked %"}</span><input type="number" name="booking_rate" step="0.1" min={1} max={100} defaultValue={pctIn(gs.booking_rate)} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "نسبة الحضور %" : "Booked → attended %"}</span><input type="number" name="show_rate" step="0.1" min={1} max={100} defaultValue={pctIn(gs.show_rate)} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الزيادة من عملاء جدد %" : "Growth from new leads %"}</span><input type="number" name="new_lead_share" step="1" min={0} max={100} defaultValue={pctIn(gs.new_lead_share)} className="gf-input num" disabled={!canEdit} /></label>
        {canEdit && <div className="flex items-end"><SubmitButton pendingLabel="…" className="gf-btn-gold w-full">{ar ? "حفظ الافتراضات" : "Save assumptions"}</SubmitButton></div>}
        <p className="text-[11px] text-ivory-300/70 sm:col-span-3 lg:col-span-6">
          {ar ? "نسب الحجز والحضور افتراضات مبدئية. بعد أول أسبوع شغل، استبدل نسبة الحجز بالنسبة الفعلية الظاهرة في لوحة التحكم (حجز ÷ إجمالي العملاء)."
              : "Booking and show rates are starting assumptions. After the first working week, replace the booking rate with the measured one on the control board (booked ÷ total leads)."}
        </p>
      </form>
      <div className="gf-card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead><tr>{[ar ? "القسم" : "Department", ar ? "مرضى اليوم / شهر" : "Patients today / mo", ar ? "هدف م١" : "Phase 1", ar ? "هدف م٢" : "Phase 2", ar ? "هدف م٣" : "Phase 3", ""].map((h, i) => <th key={i} className="gf-th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-coal-600/70">
            {depts.map((d) => (
              <tr key={d.code}>
                <td className="gf-td font-semibold">{ar ? d.name_ar : d.name_en}</td>
                {(["baseline_month", "target_p1", "target_p2", "target_p3"] as const).map((k) => (
                  <td key={k} className="gf-td"><input form={`gd-${d.code}`} name={k} type="number" min={0} defaultValue={d[k]} className="gf-input num w-24" disabled={!canEdit} aria-label={k} /></td>
                ))}
                <td className="gf-td">{canEdit && <form id={`gd-${d.code}`} action={saveGrowthDepartment}><input type="hidden" name="code" value={d.code} />
                  <SubmitButton pendingLabel="…" className="gf-btn-ghost min-h-0 px-3 py-1.5 text-xs">{ar ? "حفظ" : "Save"}</SubmitButton></form>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CampaignForm({ c, ar, canEdit, depts }: { c?: Campaign; ar: boolean; canEdit: boolean; depts: Dept[] }) {
  return (
    <details data-form className="gf-card" open={!c}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        {c ? <>
          <span className="num font-bold text-gold-300">{c.code}</span>
          <span className="text-sm">{ar ? c.name_ar : c.name_en}</span>
          <span className="ms-auto rounded bg-coal-700 px-2 py-0.5 text-[11px] text-ivory-200">{c.always_on ? (ar ? "دائمة" : "Always on") : c.starts_on || c.ends_on ? `${c.starts_on ?? "…"} → ${c.ends_on ?? "…"}` : (ar ? "بدون تواريخ" : "Undated")}</span>
          <span className={`rounded px-2 py-0.5 text-[11px] ${c.is_active ? "bg-emerald-500/20 text-emerald-200" : "bg-coal-600 text-ivory-300"}`}>{c.is_active ? (ar ? "نشطة" : "Active") : (ar ? "متوقفة" : "Inactive")}</span>
        </> : <span className="text-sm font-semibold text-gold-100">{ar ? "+ كود حملة جديد" : "+ New campaign code"}</span>}
      </summary>
      <form action={saveCampaign} className="grid gap-3 border-t border-coal-600 p-4 sm:grid-cols-2">
        {c && <input type="hidden" name="id" value={c.id} />}
        <label><span className="gf-label">{ar ? "الكود" : "Code"}</span><input name="code" required defaultValue={c?.code} placeholder="SUMMER27-LASER" className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الخدمة (تظهر عند الحجز)" : "Service (prefilled on booking)"}</span><input name="service_label" defaultValue={c?.service_label ?? ""} className="gf-input" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الاسم بالعربية" : "Arabic name"}</span><input name="name_ar" required defaultValue={c?.name_ar} className="gf-input" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الاسم بالإنجليزية" : "English name"}</span><input name="name_en" required defaultValue={c?.name_en} className="gf-input" dir="ltr" disabled={!canEdit} /></label>
        <label className="sm:col-span-2"><span className="gf-label">{ar ? "كلمات مفتاحية (مفصولة بفاصلة)" : "Keywords (comma separated)"}</span>
          <input name="keywords" defaultValue={c?.keywords.join("، ")} className="gf-input" disabled={!canEdit} /></label>
        <label className="sm:col-span-2"><span className="gf-label">{ar ? "أرقام إعلانات ميتا (Ad IDs)" : "Meta ad ids"}</span>
          <input name="meta_ad_ids" defaultValue={c?.meta_ad_ids.join(", ")} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "من" : "Starts"}</span><input type="date" name="starts_on" defaultValue={c?.starts_on ?? ""} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "إلى" : "Ends"}</span><input type="date" name="ends_on" defaultValue={c?.ends_on ?? ""} className="gf-input num" disabled={!canEdit} /></label>
        <label className="sm:col-span-2"><span className="gf-label">{ar ? "يُحسب لقسم (أهداف النمو)" : "Counts toward department (growth targets)"}</span>
          <select name="growth_department" defaultValue={c?.growth_department ?? ""} className="gf-input" disabled={!canEdit}>
            <option value="">{ar ? "— لا يُحسب لقسم —" : "— no department —"}</option>
            {depts.map((d) => <option key={d.code} value={d.code}>{ar ? d.name_ar : d.name_en}</option>)}
          </select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="always_on" defaultChecked={c?.always_on ?? false} disabled={!canEdit} />{ar ? "دائمة طول السنة (بدون تواريخ)" : "Always on all year (no dates)"}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} disabled={!canEdit} />{ar ? "نشطة" : "Active"}</label>
        {canEdit && <SubmitButton pendingLabel="…" className="gf-btn-gold sm:col-span-2">{ar ? "حفظ الحملة" : "Save campaign"}</SubmitButton>}
      </form>
    </details>
  );
}
