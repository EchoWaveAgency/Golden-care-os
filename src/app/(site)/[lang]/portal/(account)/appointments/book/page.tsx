import { getPortal, cardName } from "@/lib/portal";
import { getDoctors, getSpecialties, pick, type Lang } from "@/lib/site/api";
import { Banner } from "@/components/Banner";
import { PortalBooking } from "./PortalBooking";

export default async function PortalBook({ params, searchParams }: { params: { lang: Lang }; searchParams: { error?: string } }) {
  const { active, isSelf, ar, lang } = await getPortal(params.lang);
  const [specialties, doctors] = await Promise.all([getSpecialties().catch(() => []), getDoctors().catch(() => [])]);
  const online = doctors.filter((d) => d.accepts_online_booking);
  const used = new Set(online.map((d) => d.specialty.slug));
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "حجز موعد" : "Book a visit"}{!isSelf && <span className="ms-2 text-base font-normal text-ink-500">— {cardName(active, lang)}</span>}</h1>
      <Banner error={searchParams.error} />
      <PortalBooking lang={lang}
        specialties={specialties.filter((s) => used.has(s.slug)).map((s) => ({ slug: s.slug, title: pick(s, "title", lang) }))}
        doctors={online.map((d) => ({ id: d.id, name: pick(d, "name", lang), title: pick(d, "title", lang), specialtySlug: d.specialty.slug,
          specialty: lang === "ar" ? d.specialty.name_ar : d.specialty.name_en }))} />
    </div>
  );
}
