import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { clinicToday, dateTime, rangeStart } from "@/lib/format";
import { LEAD_KIND, LEAD_STATUS } from "@/lib/leads";
import { addLeadActivity, assignLeadToMe, convertLead, setLeadStatus } from "@/app/actions/leads";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";

export const dynamic = "force-dynamic";

type Lead = {
  id: string; ref: string; kind: string; status: string; channel: string; full_name: string; phone: string; email: string | null;
  message: string | null; preferred_slot: string | null; consent_marketing: boolean; created_at: string; due_at: string | null;
  first_contact_at: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; page_path: string | null;
  patient_id: string | null; appointment_id: string | null; assigned_to: string | null; doctor_id: string | null; specialty_id: string | null;
  close_reason: string | null; lang: string;
  specialty: { name_ar: string; name_en: string } | null; offer: { title_ar: string; title_en: string } | null;
};

export default async function LeadPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; converted?: string; doctor?: string; day?: string } }) {
  const ctx = await requireAny("lead.read");
  const { locale } = ctx;
  const ar = locale === "ar";
  const { data: l } = await ctx.supabase.from("leads")
    .select("*, specialty:specialties(name_ar, name_en), offer:offers(title_ar, title_en)").eq("id", params.id).maybeSingle<Lead>();
  if (!l) notFound();

  const doctorId = searchParams.doctor ?? l.doctor_id ?? "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day ?? "") ? searchParams.day! : (l.preferred_slot ? rangeStart(l.preferred_slot).slice(0, 10) : clinicToday());
  const [{ data: acts }, { data: doctors }, { data: slots }, { data: apt }] = await Promise.all([
    ctx.supabase.from("lead_activities").select("id, kind, body, created_at").eq("lead_id", l.id).order("created_at", { ascending: false }),
    ctx.supabase.from("staff").select("id, full_name_ar, full_name_en, specialty_id").eq("kind", "doctor").eq("is_active", true).order("full_name_ar"),
    doctorId && ctx.can("appointment.write") ? ctx.supabase.rpc("staff_available_slots", { p_doctor: doctorId, p_from: day, p_days: 3 }) : Promise.resolve({ data: [] }),
    l.appointment_id ? ctx.supabase.from("appointments").select("ref, slot, status").eq("id", l.appointment_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const canWrite = ctx.can("lead.write");
  const open = ["inquiry", "contacted", "qualified", "appointment_requested"].includes(l.status);
  const preferredStart = l.preferred_slot ? rangeStart(l.preferred_slot) : null;
  const slotList = (slots ?? []) as { slot_start: string; slot_end: string }[];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={l.full_name}
        subtitle={`${l.ref} · ${ar ? LEAD_KIND[l.kind]?.ar : LEAD_KIND[l.kind]?.en} · ${ar ? LEAD_STATUS[l.status]?.ar : LEAD_STATUS[l.status]?.en}`}
        actions={<Link href="/os/leads" className="btn-ghost">{ctx.t("common.back")}</Link>}
      />
      <Banner error={searchParams.error} success={searchParams.converted ? (ar ? "تم تسجيل المريض وحجز الموعد وربطه بالطلب." : "Patient registered, appointment booked and linked.") : undefined} />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card space-y-3 p-5 text-sm lg:col-span-1">
          <Row k={ar ? "الموبايل" : "Mobile"} v={<span className="num">{l.phone}</span>} />
          {l.email && <Row k="Email" v={<span className="num">{l.email}</span>} />}
          <Row k={ar ? "التخصص" : "Specialty"} v={(ar ? l.specialty?.name_ar : l.specialty?.name_en) ?? "—"} />
          {l.offer && <Row k={ar ? "العرض" : "Offer"} v={ar ? l.offer.title_ar : l.offer.title_en} />}
          <Row k={ar ? "الموعد المفضل" : "Preferred time"} v={preferredStart ? dateTime(preferredStart, locale) : "—"} />
          <Row k={ar ? "المصدر" : "Source"} v={[l.utm_source, l.utm_medium, l.utm_campaign].filter(Boolean).join(" / ") || l.channel} />
          {l.page_path && <Row k={ar ? "الصفحة" : "Page"} v={<span className="num text-xs">{l.page_path}</span>} />}
          <Row k={ar ? "وقت الاستلام" : "Received"} v={dateTime(l.created_at, locale)} />
          <Row k={ar ? "أول تواصل" : "First contact"} v={l.first_contact_at ? dateTime(l.first_contact_at, locale) : (ar ? "لم يتم بعد" : "Not yet")} />
          <Row k={ar ? "موافقة تسويقية" : "Marketing consent"} v={l.consent_marketing ? (ar ? "نعم" : "Yes") : (ar ? "لا" : "No")} />
          {l.message && <div><p className="label">{ar ? "رسالة المريض" : "Message"}</p><p className="whitespace-pre-wrap">{l.message}</p></div>}
          {l.patient_id && <Link href={`/os/patients/${l.patient_id}`} className="btn-ghost w-full">{ar ? "فتح ملف المريض" : "Open patient file"}</Link>}
          {apt && <p className="rounded-lg bg-ok-50 p-3 text-ok">{ar ? "الموعد" : "Appointment"}: <span className="num">{apt.ref}</span> · {dateTime(rangeStart(apt.slot), locale)}</p>}
          {canWrite && !l.assigned_to && (
            <form action={assignLeadToMe}><input type="hidden" name="id" value={l.id} />
              <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "استلام الطلب" : "Take this request"}</SubmitButton></form>
          )}
        </section>

        <div className="space-y-6 lg:col-span-2">
          {canWrite && open && ctx.can("appointment.write") && (
            <section className="card p-5">
              <h2 className="mb-3 font-medium text-navy-700">{ar ? "تحويل إلى موعد" : "Convert to appointment"}</h2>
              <form className="mb-3 grid gap-2 sm:grid-cols-3">
                <select name="doctor" defaultValue={doctorId} className="input sm:col-span-2" aria-label={ar ? "الطبيب" : "Doctor"}>
                  <option value="">{ar ? "اختر الطبيب" : "Choose doctor"}</option>
                  {(doctors ?? []).map((d: { id: string; full_name_ar: string; full_name_en: string | null }) => (
                    <option key={d.id} value={d.id}>{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</option>
                  ))}
                </select>
                <input type="date" name="day" defaultValue={day} className="input" aria-label={ar ? "اليوم" : "Day"} />
                <button className="btn-ghost sm:col-span-3">{ar ? "عرض المواعيد المتاحة" : "Show available times"}</button>
              </form>
              {doctorId && (slotList.length === 0 ? (
                <p className="text-sm text-ink-500">{ar ? "لا توجد مواعيد متاحة في هذه الأيام. جرّب يومًا آخر أو راجع جدول الطبيب." : "No free times on these days. Try another day or check the doctor's schedule."}</p>
              ) : (
                <form action={convertLead}>
                  <input type="hidden" name="id" value={l.id} />
                  <input type="hidden" name="doctor_id" value={doctorId} />
                  <div className="mb-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                    {slotList.map((s) => (
                      <label key={s.slot_start} className="cursor-pointer">
                        <input type="radio" name="slot" value={`${s.slot_start}|${s.slot_end}`} className="peer sr-only" required
                          defaultChecked={preferredStart === new Date(s.slot_start).toISOString()} />
                        <span className="block rounded-lg border border-ivory-300 px-3 py-1.5 text-sm peer-checked:border-teal-700 peer-checked:bg-teal-700 peer-checked:text-white">
                          {dateTime(s.slot_start, locale, { dateStyle: "short" })}
                        </span>
                      </label>
                    ))}
                  </div>
                  <SubmitButton pendingLabel={ctx.t("common.loading")}>{ar ? "تسجيل المريض وحجز الموعد" : "Register patient & book"}</SubmitButton>
                </form>
              ))}
            </section>
          )}

          {canWrite && (
            <section className="card p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                {open && ["contacted", "qualified"].filter((s) => s !== l.status).map((s) => (
                  <form key={s} action={setLeadStatus}>
                    <input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value={s} />
                    <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? LEAD_STATUS[s].ar : LEAD_STATUS[s].en}</SubmitButton>
                  </form>
                ))}
                {l.status === "visit_completed" && (
                  <form action={setLeadStatus}>
                    <input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="follow_up_completed" />
                    <SubmitButton pendingLabel="…" className="btn-primary">{LEAD_STATUS.follow_up_completed[ar ? "ar" : "en"]}</SubmitButton>
                  </form>
                )}
                {l.status !== "closed" && (
                  <details className="relative">
                    <summary className="btn-ghost cursor-pointer list-none text-danger">{ar ? "إغلاق الطلب" : "Close request"}</summary>
                    <form action={setLeadStatus} className="card absolute z-10 mt-1 w-72 space-y-2 p-3 ltr:left-0 rtl:right-0">
                      <input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="closed" />
                      <label className="label" htmlFor="reason">{ctx.t("common.reason")}</label>
                      <input id="reason" name="reason" required className="input" placeholder={ar ? "مثال: حجز في مكان آخر / رقم خاطئ" : "e.g. booked elsewhere / wrong number"} />
                      <SubmitButton pendingLabel="…" className="btn-danger w-full">{ar ? "إغلاق" : "Close"}</SubmitButton>
                    </form>
                  </details>
                )}
              </div>
              <form action={addLeadActivity} className="grid gap-2 sm:grid-cols-6">
                <input type="hidden" name="id" value={l.id} />
                <select name="kind" className="input sm:col-span-1" aria-label={ar ? "النوع" : "Type"}>
                  <option value="call">{ar ? "مكالمة" : "Call"}</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="note">{ar ? "ملاحظة" : "Note"}</option>
                </select>
                <input name="body" required className="input sm:col-span-4" placeholder={ar ? "ماذا حدث؟" : "What happened?"} />
                <SubmitButton pendingLabel="…" className="btn-primary sm:col-span-1">{ctx.t("common.save")}</SubmitButton>
              </form>
            </section>
          )}

          <section className="card p-5">
            <h2 className="mb-3 font-medium text-navy-700">{ar ? "سجل الطلب" : "Timeline"}</h2>
            <ul className="space-y-3 text-sm">
              {(acts ?? []).map((a: { id: number; kind: string; body: string | null; created_at: string }) => (
                <li key={a.id} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gold-500" />
                  <div>
                    <p>{a.body}</p>
                    <p className="text-xs text-ink-300">{a.kind} · <span className="whitespace-nowrap">{dateTime(a.created_at, locale)}</span></p>
                  </div>
                </li>
              ))}
              <li className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                <div><p>{ar ? "تم استلام الطلب" : "Request received"}</p><p className="text-xs text-ink-300 whitespace-nowrap">{dateTime(l.created_at, locale)}</p></div>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="text-ink-500">{k}</span><span className="text-end">{v}</span></div>;
}
