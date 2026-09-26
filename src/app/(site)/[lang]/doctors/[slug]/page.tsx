import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDoctor, pick, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Monogram } from "@/components/site/Monogram";
import { Feathers } from "@/components/site/Feathers";
import { JsonLd, physicianJsonLd } from "@/components/site/JsonLd";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang; slug: string } }): Promise<Metadata> {
  const d = await getDoctor(params.slug).catch(() => null);
  if (!d) return {};
  const name = params.lang === "ar" ? d.name_ar : d.name_en;
  return { title: name, description: pick(d, "bio", params.lang) || undefined,
    alternates: { canonical: `/${params.lang}/doctors/${params.slug}`, languages: { ar: `/ar/doctors/${params.slug}`, en: `/en/doctors/${params.slug}` } } };
}
export default async function DoctorPage({ params }: { params: { lang: Lang; slug: string } }) {
  const lang = params.lang; const c = copy(lang);
  const d = await getDoctor(params.slug).catch(() => null);
  if (!d) notFound();
  const name = lang === "ar" ? d.name_ar : d.name_en;
  const specialty = lang === "ar" ? d.specialty.name_ar : d.specialty.name_en;
  return (
    <>
      <JsonLd data={physicianJsonLd(lang, name, specialty, d.slug)} />
      <section className="border-b border-ivory-300/60 bg-gradient-to-b from-white to-ivory-50">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-14 text-center sm:flex-row sm:text-start">
          {d.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.photo_url} alt={name} className="h-32 w-32 rounded-full object-cover ring-2 ring-gold-300 ring-offset-4" />
          ) : <Monogram name={name} size="h-32 w-32 text-4xl" />}
          <div>
            <h1 className="text-3xl font-semibold text-navy-700">{name}</h1>
            <p className="mt-1 text-teal-700">{pick(d, "title", lang) || specialty}</p>
            {d.specialty.slug && <Link href={`/${lang}/specialties/${d.specialty.slug}`} className="mt-2 inline-block text-sm text-gold-700 hover:underline">{specialty}</Link>}
            <Feathers className="mt-4 w-24" />
          </div>
        </div>
      </section>
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          {pick(d, "bio", lang) && <p className="whitespace-pre-wrap leading-8">{pick(d, "bio", lang)}</p>}
          {pick(d, "qualifications", lang) && (
            <div className="rounded-2xl border border-ivory-300/70 bg-white p-6">
              <h2 className="mb-2 font-semibold text-navy-700">{lang === "ar" ? "المؤهلات" : "Qualifications"}</h2>
              <p className="whitespace-pre-wrap text-sm leading-7 text-ink-500">{pick(d, "qualifications", lang)}</p>
            </div>
          )}
        </div>
        <aside>
          {d.accepts_online_booking && <Link href={`/${lang}/book?doctor=${d.slug}`} className="block rounded-full bg-teal-700 px-5 py-3 text-center font-medium text-white hover:bg-teal-900">{c.book}</Link>}
        </aside>
      </div>
    </>
  );
}
