import type { Metadata } from "next";
import { Suspense } from "react";
import { getDoctors, getOffers, getSpecialties, pick, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { BookingWizard } from "@/components/site/BookingWizard";

export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).bookTitle, alternates: { canonical: `/${params.lang}/book`, languages: { ar: "/ar/book", en: "/en/book" } } };
}
export default async function Book({ params, searchParams }: { params: { lang: Lang }; searchParams: { specialty?: string; doctor?: string; offer?: string } }) {
  const lang = params.lang; const c = copy(lang);
  const [specialties, doctors, offers] = await Promise.all([getSpecialties().catch(() => []), getDoctors().catch(() => []), getOffers().catch(() => [])]);
  const offer = offers.find((o) => o.slug === searchParams.offer);
  return (
    <>
      <PageHero title={c.bookTitle} subtitle={offer ? pick(offer, "title", lang) : c.bookingNote} />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <Suspense>
          <BookingWizard lang={lang}
            specialties={specialties.map((s) => ({ slug: s.slug, title: pick(s, "title", lang) }))}
            doctors={doctors.map((d) => ({ id: d.id, slug: d.slug, name: lang === "ar" ? d.name_ar : d.name_en, specialtySlug: d.specialty.slug,
              title: pick(d, "title", lang) || (lang === "ar" ? d.specialty.name_ar : d.specialty.name_en), online: d.accepts_online_booking }))}
            initialSpecialty={searchParams.specialty} initialDoctor={searchParams.doctor} offerSlug={offer?.slug} />
        </Suspense>
      </div>
    </>
  );
}
