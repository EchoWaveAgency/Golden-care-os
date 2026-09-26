import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { saveService, setServicePrice, addSchedule, endSchedule, addException, saveSiteSetting } from "@/app/actions/settings";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const DAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string; error?: string; saved?: string } }) {
  const ctx = await requireAny("settings.manage");
  const ar = ctx.locale === "ar";
  const tab = ["services", "schedules", "site"].includes(searchParams.tab ?? "") ? searchParams.tab! : "services";
  const tabs: [string, string, string][] = [["services", "الخدمات والأسعار", "Services & prices"], ["schedules", "جداول الأطباء", "Doctor schedules"], ["site", "بيانات التواصل والموقع", "Contact & website"]];

  return (
    <>
      <PageHeader title={ctx.t("nav.settings")} />
      <nav className="mb-5 flex flex-wrap gap-2">
        {tabs.map(([k, a, e]) => (
          <Link key={k} href={`/os/settings?tab=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === tab ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>
        ))}
      </nav>
      <Banner error={searchParams.error} success={searchParams.saved ? (ar ? "تم الحفظ." : "Saved.") : undefined} />
      {tab === "services" && <Services ar={ar} />}
      {tab === "schedules" && <Schedules ar={ar} />}
      {tab === "site" && <Site ar={ar} />}
    </>
  );

  async function Services({ ar }: { ar: boolean }) {
    const [{ data: services }, { data: specialties }] = await Promise.all([
      ctx.supabase.from("services").select("id, code, name_ar, name_en, specialty_id, is_active, public_visible, public_show_price, online_bookable, specialty:specialties(name_ar, name_en)").order("code"),
      ctx.supabase.from("specialties").select("id, name_ar, name_en").order("sort_order"),
    ]);
    const prices = new Map<string, number | null>();
    await Promise.all((services ?? []).map(async (s) => {
      const { data } = await ctx.supabase.rpc("service_price", { p_service: s.id, p_branch: ctx.branchId });
      prices.set(s.id, data as number | null);
    }));
    return (
      <div className="space-y-6">
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{ar ? "الكود" : "Code"}</th><th className="th">{ar ? "الخدمة" : "Service"}</th>
                <th className="th">{ar ? "السعر الحالي" : "Current price"}</th><th className="th">{ar ? "الموقع" : "Website"}</th>
                <th className="th">{ar ? "سعر جديد من تاريخ" : "New price from date"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {(services ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="td num">{s.code}</td>
                  <td className="td">{ar ? s.name_ar : s.name_en}<p className="text-xs text-ink-300">{(s.specialty as unknown as { name_ar: string; name_en: string } | null)?.[ar ? "name_ar" : "name_en"]}</p></td>
                  <td className="td num">{prices.get(s.id) != null ? money(prices.get(s.id)!, ctx.locale) : "—"}</td>
                  <td className="td">
                    <form action={saveService} className="space-y-1 text-xs">
                      {(["id", "code", "specialty_id", "name_ar", "name_en"] as const).map((k) => <input key={k} type="hidden" name={k} value={String(s[k])} />)}
                      <label className="flex items-center gap-1"><input type="checkbox" name="public_visible" defaultChecked={s.public_visible} /> {ar ? "تظهر" : "Visible"}</label>
                      <label className="flex items-center gap-1"><input type="checkbox" name="public_show_price" defaultChecked={s.public_show_price} /> {ar ? "السعر يظهر" : "Show price"}</label>
                      <label className="flex items-center gap-1"><input type="checkbox" name="online_bookable" defaultChecked={s.online_bookable} /> {ar ? "حجز أونلاين" : "Online booking"}</label>
                      <SubmitButton pendingLabel="…" className="btn-ghost !px-2 !py-1 text-xs">{ctx.t("common.save")}</SubmitButton>
                    </form>
                  </td>
                  <td className="td">
                    <form action={setServicePrice} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="service_id" value={s.id} />
                      <input name="price" type="number" min="0" step="0.01" required className="input num w-28" aria-label={ar ? "السعر" : "Price"} />
                      <input name="effective_from" type="date" className="input w-40" aria-label={ar ? "من تاريخ" : "From"} />
                      <SubmitButton pendingLabel="…" className="btn-ghost !px-2 !py-1 text-xs">{ctx.t("common.save")}</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={saveService} className="card grid gap-3 p-5 sm:grid-cols-5">
          <h2 className="font-medium text-navy-700 sm:col-span-5">{ar ? "خدمة جديدة" : "New service"}</h2>
          <input name="code" required placeholder="LASER-FACE" className="input num" dir="ltr" aria-label={ar ? "الكود" : "Code"} />
          <select name="specialty_id" required className="input" aria-label={ar ? "التخصص" : "Specialty"}>
            {(specialties ?? []).map((s) => <option key={s.id} value={s.id}>{ar ? s.name_ar : s.name_en}</option>)}
          </select>
          <input name="name_ar" required placeholder={ar ? "الاسم بالعربي" : "Arabic name"} className="input" />
          <input name="name_en" required placeholder={ar ? "الاسم بالإنجليزي" : "English name"} className="input" dir="ltr" />
          <SubmitButton pendingLabel="…">{ar ? "إضافة" : "Add"}</SubmitButton>
          <p className="text-xs text-ink-300 sm:col-span-5">{ar ? "الأسعار لها تاريخ سريان وتُحفظ كسجل. الأسعار القديمة على الفواتير لا تتغير." : "Prices are effective-dated and kept as history; issued invoices never change."}</p>
        </form>
      </div>
    );
  }

  async function Schedules({ ar }: { ar: boolean }) {
    const [{ data: doctors }, { data: rows }, { data: exceptions }] = await Promise.all([
      ctx.supabase.from("staff").select("id, full_name_ar, full_name_en").eq("kind", "doctor").eq("is_active", true).order("full_name_ar"),
      ctx.supabase.from("doctor_schedules").select("id, doctor_id, weekday, start_time, end_time, slot_minutes, valid_from, valid_to").order("weekday"),
      ctx.supabase.from("schedule_exceptions").select("id, doctor_id, period, kind, reason").order("created_at", { ascending: false }).limit(20),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const name = (id: string | null) => {
      const d = (doctors ?? []).find((x) => x.id === id);
      return d ? (ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar) : (ar ? "كل الفرع" : "Whole branch");
    };
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          {(doctors ?? []).map((d) => {
            const mine = (rows ?? []).filter((r) => r.doctor_id === d.id && (!r.valid_to || r.valid_to >= today));
            return (
              <div key={d.id} className="card p-5">
                <h3 className="mb-3 font-medium text-navy-700">{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</h3>
                {mine.length === 0 ? <p className="text-sm text-ink-300">{ar ? "لا يوجد جدول — لن تظهر له مواعيد أونلاين." : "No schedule — no online times will show."}</p> : (
                  <ul className="space-y-1 text-sm">
                    {mine.map((r) => (
                      <li key={r.id} className="flex items-center justify-between">
                        <span>{(ar ? DAYS_AR : DAYS_EN)[r.weekday]} · <span className="num">{r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}</span> · {r.slot_minutes}{ar ? " د" : "m"}{r.valid_to ? ` (${ar ? "حتى" : "until"} ${r.valid_to})` : ""}</span>
                        {!r.valid_to && <form action={endSchedule}><input type="hidden" name="id" value={r.id} /><button className="text-xs text-danger hover:underline">{ar ? "إيقاف" : "End"}</button></form>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <form action={addSchedule} className="card grid gap-3 p-5 md:grid-cols-6">
          <h2 className="font-medium text-navy-700 md:col-span-6">{ar ? "إضافة ساعات عمل" : "Add working hours"}</h2>
          <select name="doctor_id" required className="input md:col-span-2" aria-label={ar ? "الطبيب" : "Doctor"}>
            {(doctors ?? []).map((d) => <option key={d.id} value={d.id}>{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</option>)}
          </select>
          <input name="start_time" type="time" required defaultValue="10:00" className="input" aria-label={ar ? "من" : "From"} />
          <input name="end_time" type="time" required defaultValue="18:00" className="input" aria-label={ar ? "إلى" : "To"} />
          <select name="slot_minutes" defaultValue="20" className="input" aria-label={ar ? "مدة الموعد" : "Slot"}>
            {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} {ar ? "دقيقة" : "min"}</option>)}
          </select>
          <SubmitButton pendingLabel="…">{ar ? "إضافة" : "Add"}</SubmitButton>
          <div className="flex flex-wrap gap-3 text-sm md:col-span-6">
            {(ar ? DAYS_AR : DAYS_EN).map((d, i) => <label key={i} className="flex items-center gap-1"><input type="checkbox" name="weekday" value={i} defaultChecked={i !== 5} /> {d}</label>)}
          </div>
        </form>
        <form action={addException} className="card grid gap-3 p-5 md:grid-cols-6">
          <h2 className="font-medium text-navy-700 md:col-span-6">{ar ? "إجازة / عطلة / إيقاف مواعيد" : "Leave / holiday / blocked time"}</h2>
          <select name="doctor_id" className="input md:col-span-2" aria-label={ar ? "الطبيب" : "Doctor"}>
            <option value="">{ar ? "كل الفرع (عطلة)" : "Whole branch (holiday)"}</option>
            {(doctors ?? []).map((d) => <option key={d.id} value={d.id}>{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</option>)}
          </select>
          <input name="from" type="date" required className="input" aria-label={ar ? "من" : "From"} />
          <input name="to" type="date" required className="input" aria-label={ar ? "إلى" : "To"} />
          <select name="kind" className="input" aria-label={ar ? "النوع" : "Kind"}>
            <option value="leave">{ar ? "إجازة" : "Leave"}</option><option value="holiday">{ar ? "عطلة رسمية" : "Holiday"}</option><option value="blocked">{ar ? "إيقاف" : "Blocked"}</option>
          </select>
          <SubmitButton pendingLabel="…">{ar ? "إضافة" : "Add"}</SubmitButton>
          <input name="reason" placeholder={ar ? "السبب" : "Reason"} className="input md:col-span-6" />
          <ul className="space-y-1 text-xs text-ink-500 md:col-span-6">
            {(exceptions ?? []).map((x) => <li key={x.id}>{name(x.doctor_id)} · {x.kind} · <span className="num">{String(x.period).slice(1, 11)}</span>{x.reason ? ` — ${x.reason}` : ""}</li>)}
          </ul>
        </form>
      </div>
    );
  }

  async function Site({ ar }: { ar: boolean }) {
    const { data } = await ctx.supabase.from("site_settings").select("key, value_ar, value_en").order("key");
    const labels: Record<string, [string, string, string?]> = {
      address: ["العنوان", "Address"], mobile: ["رقم الموبايل", "Mobile number"], whatsapp: ["رقم واتساب (دولي بدون +)", "WhatsApp (international, digits only)", "201xxxxxxxxx"],
      map_url: ["رابط الخريطة", "Map link"], hours: ["مواعيد العمل", "Working hours"], email: ["البريد الإلكتروني", "Email"],
      "analytics.ga4": ["Google Analytics 4 ID", "Google Analytics 4 ID", "G-XXXX"], "analytics.meta_pixel": ["Meta Pixel ID", "Meta Pixel ID"],
      "analytics.tiktok_pixel": ["TikTok Pixel ID", "TikTok Pixel ID"], "analytics.google_ads": ["Google Ads ID", "Google Ads ID", "AW-XXXX"],
    };
    return (
      <div className="card divide-y divide-ivory-200">
        {(data ?? []).map((s) => (
          <form key={s.key} action={saveSiteSetting} className="grid gap-2 p-4 md:grid-cols-7 md:items-center">
            <input type="hidden" name="key" value={s.key} />
            <p className="text-sm font-medium md:col-span-2">{labels[s.key]?.[ar ? 0 : 1] ?? s.key}</p>
            <input name="value_ar" defaultValue={s.value_ar ?? ""} placeholder={labels[s.key]?.[2] ?? (ar ? "بالعربي" : "Arabic")} className="input md:col-span-2" />
            <input name="value_en" defaultValue={s.value_en ?? ""} placeholder={labels[s.key]?.[2] ?? "English"} dir="ltr" className="input md:col-span-2" />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ctx.t("common.save")}</SubmitButton>
          </form>
        ))}
        <p className="p-4 text-xs text-ink-300">{ar ? "أكواد التتبع لا تعمل إلا بعد موافقة الزائر على ملفات تعريف الارتباط، ولا تُرسل بيانات المرضى." : "Tracking IDs only load after visitor cookie consent and never receive patient data."}</p>
      </div>
    );
  }
}
