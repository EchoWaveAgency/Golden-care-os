import type { Metadata } from "next";
import { getSpecialties, pick, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { SpecialtyDirectory } from "@/components/site/SpecialtyDirectory";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  const c = copy(params.lang);
  return { title: c.specialties, alternates: { canonical: `/${params.lang}/specialties`, languages: { ar: "/ar/specialties", en: "/en/specialties" } } };
}

export default async function Specialties({ params }: { params: { lang: Lang } }) {
  const lang = params.lang; const c = copy(lang);
  const list = await getSpecialties().catch(() => []);
  return (
    <>
      <PageHero title={c.ourSpecialties} subtitle={c.heroText} />
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6"><SpecialtyDirectory list={list} lang={lang} /></div>
    </>
  );
}
