import Link from "next/link";
import { headers } from "next/headers";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { GfBanner, GfHeader } from "@/components/gf/Frame";
import { Since } from "@/components/gf/Live";
import { SubmitButton } from "@/components/SubmitButton";
import { saveCampaign, saveLeadSettings, setDuty } from "@/app/actions/lead-flow";

export const metadata = { title: "Golden Friday settings" };
export const dynamic = "force-dynamic";

type Campaign = { id: string; code: string; name_ar: string; name_en: string; service_label: string | null; keywords: string[]; meta_ad_ids: string[];
  is_active: boolean; starts_on: string | null; ends_on: string | null };

export default async function GoldenSettings({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("lead.campaigns", "lead.assign");
  const ar = ctx.locale === "ar";
  const [{ data: camps }, { data: settings }, { data: people }, { data: last }] = await Promise.all([
    ctx.supabase.from("lead_campaigns").select("*").order("is_active", { ascending: false }).order("code").returns<Campaign[]>(),
    ctx.supabase.from("lead_flow_settings").select("code_prefix, sla_minutes, auto_assign, updated_at").maybeSingle(),
    ctx.supabase.rpc("lead_agents"),
    ctx.supabase.from("lead_messages").select("received_at").eq("direction", "in").order("received_at", { ascending: false }).limit(1).maybeSingle(),
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
      <GfHeader ar={ar} title={ar ? "الحملات والإعدادات" : "Campaigns & settings"} actions={<Link href="/os/golden" className="gf-btn-ghost">{ar ? "لوحة التحكم" : "Control"}</Link>} />
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
                        <input type="hidden" name="user" value={s.user_id} /><input type="hidden" name="on" value={s.on_duty ? "0" : "1"} /><input type="hidden" name="back" value="/os/golden/settings" />
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
            {ar ? "ضع الكود في الرسالة الجاهزة لإعلان Click-to-WhatsApp (مثال: «GF26-LASER — أريد تفاصيل عرض الليزر»). الترتيب: الكود في الرسالة ← رقم الإعلان ← الكلمات المفتاحية لحملة نشطة ← اسم حملة ميتا."
                : "Put the code in the Click-to-WhatsApp ad's pre-filled message (e.g. “GF26-LASER — I want the laser offer”). Order: code in the message → ad id → keywords of a live campaign → Meta campaign name."}
          </p>
          {(camps ?? []).map((c) => <CampaignForm key={c.id} c={c} ar={ar} canEdit={canEdit} />)}
          {canEdit && <CampaignForm ar={ar} canEdit />}
        </section>
      </div>
    </div>
  );
}

function CampaignForm({ c, ar, canEdit }: { c?: Campaign; ar: boolean; canEdit: boolean }) {
  return (
    <details data-form className="gf-card" open={!c}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        {c ? <>
          <span className="num font-bold text-gold-300">{c.code}</span>
          <span className="text-sm">{ar ? c.name_ar : c.name_en}</span>
          <span className={`ms-auto rounded px-2 py-0.5 text-[11px] ${c.is_active ? "bg-emerald-500/20 text-emerald-200" : "bg-coal-600 text-ivory-300"}`}>{c.is_active ? (ar ? "نشطة" : "Active") : (ar ? "متوقفة" : "Inactive")}</span>
        </> : <span className="text-sm font-semibold text-gold-100">{ar ? "+ كود حملة جديد" : "+ New campaign code"}</span>}
      </summary>
      <form action={saveCampaign} className="grid gap-3 border-t border-coal-600 p-4 sm:grid-cols-2">
        {c && <input type="hidden" name="id" value={c.id} />}
        <label><span className="gf-label">{ar ? "الكود" : "Code"}</span><input name="code" required defaultValue={c?.code} placeholder="GF26-LASER" className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الخدمة (تظهر عند الحجز)" : "Service (prefilled on booking)"}</span><input name="service_label" defaultValue={c?.service_label ?? ""} className="gf-input" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الاسم بالعربية" : "Arabic name"}</span><input name="name_ar" required defaultValue={c?.name_ar} className="gf-input" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "الاسم بالإنجليزية" : "English name"}</span><input name="name_en" required defaultValue={c?.name_en} className="gf-input" dir="ltr" disabled={!canEdit} /></label>
        <label className="sm:col-span-2"><span className="gf-label">{ar ? "كلمات مفتاحية (مفصولة بفاصلة)" : "Keywords (comma separated)"}</span>
          <input name="keywords" defaultValue={c?.keywords.join("، ")} className="gf-input" disabled={!canEdit} /></label>
        <label className="sm:col-span-2"><span className="gf-label">{ar ? "أرقام إعلانات ميتا (Ad IDs)" : "Meta ad ids"}</span>
          <input name="meta_ad_ids" defaultValue={c?.meta_ad_ids.join(", ")} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "من" : "Starts"}</span><input type="date" name="starts_on" defaultValue={c?.starts_on ?? ""} className="gf-input num" disabled={!canEdit} /></label>
        <label><span className="gf-label">{ar ? "إلى" : "Ends"}</span><input type="date" name="ends_on" defaultValue={c?.ends_on ?? ""} className="gf-input num" disabled={!canEdit} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={c?.is_active ?? true} disabled={!canEdit} />{ar ? "نشطة" : "Active"}</label>
        {canEdit && <SubmitButton pendingLabel="…" className="gf-btn-gold sm:col-span-2">{ar ? "حفظ الحملة" : "Save campaign"}</SubmitButton>}
      </form>
    </details>
  );
}
