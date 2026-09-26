import Link from "next/link";
import type { Metadata } from "next";
import { getSpecialties, pick, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { SpecialtyIcon } from "@/components/site/SpecialtyIcon";

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
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {list.map((s) => (
          <Link key={s.slug} href={`/${lang}/specialties/${s.slug}`} className="group flex gap-4 rounded-2xl border border-ivory-300/70 bg-white p-6 hover:border-gold-300 hover:shadow-card">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700 group-hover:bg-teal-700 group-hover:text-white"><SpecialtyIcon code={s.code} /></span>
            <span>
              <span className="block text-lg font-semibold text-navy-700">{pick(s, "title", lang)}</span>
              {pick(s, "summary", lang) && <span className="mt-1 block text-sm leading-7 text-ink-500">{pick(s, "summary", lang)}</span>}
              <span className="mt-3 inline-block text-sm font-medium text-teal-700">{c.learnMore}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
