import type { Metadata } from "next";
import Link from "next/link";
import { getDoctors, getSpecialties, pick, type Doctor, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { DoctorCard } from "@/components/site/DoctorCard";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).doctors, alternates: { canonical: `/${params.lang}/doctors`, languages: { ar: "/ar/doctors", en: "/en/doctors" } } };
}

// The medical team grouped by specialty, in the same order as the specialties directory.
export default async function Doctors({ params }: { params: { lang: Lang } }) {
  const lang = params.lang; const c = copy(lang);
  const [list, specialties] = await Promise.all([getDoctors().catch(() => [] as Doctor[]), getSpecialties().catch(() => [])]);
  const groups = specialties
    .map((s) => ({ s, doctors: list.filter((d) => d.specialty.slug === s.slug || d.specialty.code === s.code) }))
    .filter((g) => g.doctors.length > 0);
  return (
    <>
      <PageHero title={c.ourDoctors} />
      {groups.length > 1 && (
        <nav aria-label={c.specialties} className="border-b border-navy-700/10 bg-white">
          <ul className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-4 sm:px-6">
            {groups.map(({ s }) => (
              <li key={s.slug} className="shrink-0"><a href={`#${s.slug}`} className="block whitespace-nowrap rounded-full border border-teal-700/25 px-4 py-2 text-sm text-teal-700 hover:bg-teal-700 hover:text-white">{pick(s, "title", lang)}</a></li>
            ))}
          </ul>
        </nav>
      )}
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {groups.map(({ s, doctors }) => (
          <section key={s.slug} id={s.slug} className="scroll-mt-24 border-b border-navy-700/10 py-12 last:border-0">
            <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-2xl font-bold text-navy-700 sm:text-3xl">{pick(s, "title", lang)}</h2>
              <Link href={`/${lang}/specialties/${s.slug}`} className="text-sm font-semibold text-teal-700 hover:underline">{c.learnMore}</Link>
            </div>
            <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {doctors.map((d) => <DoctorCard key={d.slug} doctor={d} lang={lang} />)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
