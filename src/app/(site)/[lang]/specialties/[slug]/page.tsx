import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getSpecialty, getSpecialties, pick, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { DoctorCard } from "@/components/site/DoctorCard";
import { OfferCard } from "@/components/site/OfferCard";
import { InquiryForm } from "@/components/site/InquiryForm";
import { JsonLd, faqJsonLd } from "@/components/site/JsonLd";

export const revalidate = 60;
export async function generateStaticParams() {
  const list = await getSpecialties().catch(() => []);
  return list.flatMap((s) => [{ lang: "ar", slug: s.slug }, { lang: "en", slug: s.slug }]);
}
export async function generateMetadata({ params }: { params: { lang: Lang; slug: string } }): Promise<Metadata> {
  const s = await getSpecialty(params.slug).catch(() => null);
  if (!s) return {};
  return {
    title: pick(s, "title", params.lang), description: pick(s, "summary", params.lang) || undefined,
    alternates: { canonical: `/${params.lang}/specialties/${params.slug}`, languages: { ar: `/ar/specialties/${params.slug}`, en: `/en/specialties/${params.slug}` } },
  };
}

export default async function SpecialtyPage({ params }: { params: { lang: Lang; slug: string } }) {
  const lang = params.lang; const c = copy(lang);
  const s = await getSpecialty(params.slug).catch(() => null);
  if (!s) notFound();
  const faq = (s.faq ?? []).map((f) => ({ q: lang === "ar" ? f.q_ar : f.q_en, a: lang === "ar" ? f.a_ar : f.a_en })).filter((f) => f.q);
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG").format(n);
  return (
    <>
      {faq.length > 0 && <JsonLd data={faqJsonLd(faq)} />}
      <PageHero eyebrow={c.specialties} title={pick(s, "title", lang)} subtitle={pick(s, "summary", lang)} />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          {pick(s, "body", lang) && <div className="whitespace-pre-wrap text-base leading-8 text-ink">{pick(s, "body", lang)}</div>}
          {s.services.length > 0 && (
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-navy-700">{c.services}</h2>
              <ul className="divide-y divide-ivory-300/70 rounded-2xl border border-ivory-300/70 bg-white">
                {s.services.map((sv) => (
                  <li key={sv.code} className="flex items-center justify-between gap-4 px-5 py-4">
                    <span className="text-navy-700">{lang === "ar" ? sv.name_ar : sv.name_en}</span>
                    {sv.price != null && <span className="text-sm text-gold-700"><span className="num font-semibold">{fmt(Number(sv.price))}</span> {c.egp}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pick(s, "preparation", lang) && (
            <section className="rounded-2xl bg-teal-50 p-6">
              <h2 className="mb-2 text-lg font-semibold text-teal-900">{c.preparation}</h2>
              <p className="whitespace-pre-wrap text-sm leading-7 text-teal-900/80">{pick(s, "preparation", lang)}</p>
            </section>
          )}
          {s.doctors.length > 0 && (
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-navy-700">{c.doctors}</h2>
              <div className="grid gap-5 sm:grid-cols-2">{s.doctors.map((d) => <DoctorCard key={d.slug} doctor={d} lang={lang} />)}</div>
            </section>
          )}
          {s.offers.length > 0 && (
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-navy-700">{c.currentOffers}</h2>
              <div className="grid gap-5 sm:grid-cols-2">{s.offers.map((o) => <OfferCard key={o.slug} offer={o} lang={lang} />)}</div>
            </section>
          )}
          {faq.length > 0 && (
            <section>
              <h2 className="mb-4 text-2xl font-semibold text-navy-700">{c.faq}</h2>
              <div className="space-y-2">
                {faq.map((f, i) => (
                  <details key={i} className="rounded-xl border border-ivory-300/70 bg-white px-5 py-4">
                    <summary className="cursor-pointer font-medium text-navy-700">{f.q}</summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink-500">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
          <p className="rounded-xl border border-ivory-300 bg-ivory-100 p-4 text-xs leading-6 text-ink-500">{c.medicalNote}</p>
        </div>
        <aside>
          <div className="sticky top-28 space-y-4 rounded-2xl border border-ivory-300/70 bg-white p-6 shadow-card">
            <Link href={`/${lang}/book?specialty=${s.slug}`} className="block rounded-full bg-teal-700 px-5 py-3 text-center font-medium text-white hover:bg-teal-900">{c.book}</Link>
            <p className="text-center text-xs text-ink-300">—</p>
            <h2 className="font-semibold text-navy-700">{c.callback}</h2>
            <Suspense><InquiryForm lang={lang} kind="callback" specialtySlug={s.slug} compact /></Suspense>
          </div>
        </aside>
      </div>
    </>
  );
}
