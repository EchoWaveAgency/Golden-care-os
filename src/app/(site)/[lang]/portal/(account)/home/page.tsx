import Link from "next/link";
import { getPortal, cardName, APT_STATUS, type PortalAppointment, type PortalFinance, type PortalMedical } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime, money } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export default async function PortalHome({ params }: { params: { lang: Lang } }) {
  const { supabase, me, active, full, ar, lang, isSelf } = await getPortal(params.lang);
  const base = `/${lang}/portal`;
  const [{ data: apts }, fin, med] = await Promise.all([
    supabase.rpc("portal_appointments", { p_patient: active.id }),
    full ? supabase.rpc("portal_finance", { p_patient: active.id }) : Promise.resolve({ data: null }),
    full ? supabase.rpc("portal_medical", { p_patient: active.id }) : Promise.resolve({ data: null }),
  ]);
  const list = (apts ?? []) as PortalAppointment[];
  const upcoming = list.filter((a) => new Date(a.start).getTime() > Date.now() && !["canceled", "no_show", "completed"].includes(a.status))
    .sort((a, b) => a.start.localeCompare(b.start));
  const finance = fin.data as PortalFinance | null;
  const medical = med.data as PortalMedical | null;
  const toRate = list.filter((a) => a.can_survey).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? `أهلًا ${isSelf ? me.patient.first_name_ar : cardName(active, lang)}` : `Welcome${isSelf && me.patient.first_name_en ? `, ${me.patient.first_name_en}` : ""}`}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile href={`${base}/appointments`} label={ar ? "مواعيد قادمة" : "Upcoming visits"} value={String(upcoming.length)} />
        {finance && <Tile href={`${base}/finance`} label={ar ? "المستحق عليك" : "Amount due"} value={money(finance.balance, lang)} tone={Number(finance.balance) > 0 ? "gold" : "teal"} />}
        {medical && <Tile href={`${base}/medical`} label={ar ? "روشتات متاحة" : "Prescriptions available"} value={String(medical.prescriptions.length)} />}
      </div>

      <section className="rounded-2xl border border-ivory-300/70 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-navy-700">{ar ? "موعدك القادم" : "Your next visit"}</h2>
          <Link href={`${base}/appointments/book`} className="btn-primary">{ar ? "احجز موعدًا" : "Book a visit"}</Link>
        </div>
        {upcoming.length === 0 ? <p className="text-sm text-ink-500">{ar ? "لا توجد مواعيد قادمة." : "No upcoming visits."}</p> : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-teal-50 p-4">
            <div>
              <p className="font-medium text-teal-900">{dateTime(upcoming[0].start, lang, { dateStyle: "full" })}</p>
              <p className="text-sm text-ink-500">{ar ? upcoming[0].doctor_ar : upcoming[0].doctor_en} · {ar ? upcoming[0].specialty_ar : upcoming[0].specialty_en}</p>
            </div>
            <StatusBadge status={APT_STATUS[upcoming[0].status]?.[2] ?? "booked"} label={(ar ? APT_STATUS[upcoming[0].status]?.[0] : APT_STATUS[upcoming[0].status]?.[1]) ?? upcoming[0].status} />
          </div>
        )}
      </section>

      {medical && medical.allergies.length > 0 && (
        <p className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger">{ar ? "حساسية مسجلة في ملفك:" : "Allergy recorded in your file:"} {medical.allergies.join(ar ? "، " : ", ")}. {ar ? "إذا كانت غير دقيقة أخبرنا." : "Tell us if this is not accurate."}</p>
      )}
      {toRate > 0 && (
        <Link href={`${base}/appointments`} className="block rounded-xl border border-gold-300 bg-gold-50 px-4 py-3 text-sm text-gold-800 hover:bg-gold-100">
          {ar ? "كيف كانت زيارتك الأخيرة؟ قيّمها في أقل من دقيقة." : "How was your last visit? Rate it in under a minute."}
        </Link>
      )}
    </div>
  );
}

function Tile({ href, label, value, tone = "navy" }: { href: string; label: string; value: string; tone?: "navy" | "gold" | "teal" }) {
  const c = { navy: "text-navy-700", gold: "text-gold-700", teal: "text-teal-700" }[tone];
  return (
    <Link href={href} className="rounded-2xl border border-ivory-300/70 bg-white p-5 transition hover:border-gold-300">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={`num mt-2 text-2xl font-semibold ${c}`}>{value}</p>
    </Link>
  );
}
