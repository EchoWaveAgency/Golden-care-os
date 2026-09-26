import Link from "next/link";
import { getPortal, APT_STATUS, type PortalAppointment } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { portalCancel, portalSurvey } from "@/app/actions/portal";

export default async function PortalAppointments({ params, searchParams }: { params: { lang: Lang }; searchParams: { ok?: string; error?: string } }) {
  const { supabase, active, ar, lang } = await getPortal(params.lang);
  const { data } = await supabase.rpc("portal_appointments", { p_patient: active.id });
  const list = (data ?? []) as PortalAppointment[];
  const now = Date.now();
  const upcoming = list.filter((a) => new Date(a.start).getTime() > now && !["canceled", "no_show", "completed"].includes(a.status)).sort((a, b) => a.start.localeCompare(b.start));
  const past = list.filter((a) => !upcoming.includes(a));
  const ok = searchParams.ok;
  const success = !ok ? undefined
    : ok === "cancelled" ? (ar ? "تم إلغاء الموعد. أرسلنا لك تأكيدًا على واتساب." : "The appointment was cancelled. We sent a WhatsApp confirmation.")
    : ok === "survey" ? (ar ? "شكرًا لتقييمك — يساعدنا على التحسين." : "Thank you for your rating — it helps us improve.")
    : ar ? `تم إرسال طلب الحجز رقم ${ok}. الموعد محجوز لك مؤقتًا، وسيتواصل معك فريقنا لتأكيده.` : `Booking request ${ok} sent. The time is held for you and our team will contact you to confirm.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-navy-700">{ar ? "المواعيد" : "Appointments"}</h1>
        <Link href={`/${lang}/portal/appointments/book`} className="btn-primary">{ar ? "احجز موعدًا" : "Book a visit"}</Link>
      </div>
      <Banner error={searchParams.error} success={success} />

      <section>
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "القادمة" : "Upcoming"}</h2>
        {upcoming.length === 0 ? <p className="rounded-2xl border border-ivory-300/70 bg-white p-6 text-sm text-ink-500">{ar ? "لا توجد مواعيد قادمة." : "No upcoming visits."}</p> : (
          <ul className="space-y-3">
            {upcoming.map((a) => (
              <li key={a.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
                <Head a={a} lang={lang} />
                {a.status === "requested" && <p className="mt-2 text-xs text-ink-500">{ar ? "الموعد محجوز لك مؤقتًا بانتظار تأكيد فريق العيادة." : "The time is held for you until the clinic team confirms."}</p>}
                {a.can_cancel ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-danger">{ar ? "إلغاء الموعد" : "Cancel this visit"}</summary>
                    <form action={portalCancel} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="lang" value={lang} /><input type="hidden" name="id" value={a.id} />
                      <div className="min-w-[220px] flex-1"><label className="label">{ar ? "السبب (اختياري)" : "Reason (optional)"}</label><input name="reason" className="input" maxLength={300} /></div>
                      <SubmitButton pendingLabel="…" className="btn-danger">{ar ? "تأكيد الإلغاء" : "Confirm cancellation"}</SubmitButton>
                    </form>
                  </details>
                ) : <p className="mt-3 text-xs text-ink-300">{ar ? "لتغيير هذا الموعد تواصل معنا عبر واتساب أو افتح طلبًا من صفحة الطلبات." : "To change this visit, contact us on WhatsApp or open a request."}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "السابقة" : "Past"}</h2>
        {past.length === 0 ? <p className="text-sm text-ink-500">{ar ? "لا توجد زيارات سابقة." : "No past visits."}</p> : (
          <ul className="space-y-3">
            {past.map((a) => (
              <li key={a.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
                <Head a={a} lang={lang} />
                {a.can_survey && (
                  <form action={portalSurvey} className="mt-4 rounded-xl bg-ivory-50 p-4">
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="id" value={a.id} />
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">{ar ? "كيف كانت زيارتك؟" : "How was your visit?"}</legend>
                      <div className="flex gap-2" dir="ltr">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className="cursor-pointer">
                            <input type="radio" name="score" value={n} required className="peer sr-only" />
                            <span className="grid h-10 w-10 place-items-center rounded-full border border-ivory-300 bg-white text-lg text-gold-500 peer-checked:border-gold-500 peer-checked:bg-gold-500 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500">★<span className="sr-only">{n}</span></span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <textarea name="comment" rows={2} maxLength={1000} className="input mt-3" placeholder={ar ? "ملاحظاتك (اختياري)" : "Comments (optional)"} />
                    <SubmitButton pendingLabel="…" className="btn-gold mt-3">{ar ? "إرسال التقييم" : "Send rating"}</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Head({ a, lang }: { a: PortalAppointment; lang: Lang }) {
  const ar = lang === "ar";
  const st = APT_STATUS[a.status];
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-medium text-navy-700">{dateTime(a.start, lang, { dateStyle: "full" })}</p>
        <p className="text-sm text-ink-500">{ar ? a.doctor_ar : a.doctor_en} · {ar ? a.specialty_ar : a.specialty_en}</p>
        <p className="num mt-1 text-xs text-ink-300">{a.ref}</p>
      </div>
      <StatusBadge status={st?.[2] ?? "booked"} label={(ar ? st?.[0] : st?.[1]) ?? a.status} />
    </div>
  );
}
