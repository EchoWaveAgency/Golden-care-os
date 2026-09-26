import type { Metadata } from "next";
import { getOffers, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { OfferCard } from "@/components/site/OfferCard";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).offers, alternates: { canonical: `/${params.lang}/offers`, languages: { ar: "/ar/offers", en: "/en/offers" } } };
}
export default async function Offers({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang);
  const list = await getOffers().catch(() => []);
  return (
    <>
      <PageHero title={c.currentOffers} subtitle={c.medicalNote} />
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {list.length === 0 ? <p className="text-ink-500">{params.lang === "ar" ? "لا توجد عروض سارية حاليًا." : "No active offers right now."}</p>
          : list.map((o) => <OfferCard key={o.slug} offer={o} lang={params.lang} />)}
      </div>
    </>
  );
}
