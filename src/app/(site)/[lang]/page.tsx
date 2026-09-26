import Image from "next/image";
import Link from "next/link";
import { getDoctors, getOffers, getSite, getSpecialties, pick, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Feathers } from "@/components/site/Feathers";
import { SpecialtyIcon } from "@/components/site/SpecialtyIcon";
import { DoctorCard } from "@/components/site/DoctorCard";
import { OfferCard } from "@/components/site/OfferCard";
import { JsonLd, clinicJsonLd } from "@/components/site/JsonLd";

export const revalidate = 60;

export default async function Home({ params }: { params: { lang: Lang } }) {
  const lang = params.lang;
  const c = copy(lang);
  const [site, specialties, doctors, offers] = await Promise.all([
    getSite().catch(() => ({})), getSpecialties().catch(() => []), getDoctors().catch(() => []), getOffers().catch(() => []),
  ]);
  const s = (k: string) => setting(site, k, lang);

  return (
    <>
      <JsonLd data={clinicJsonLd(lang, s("address"), s("mobile"), specialties.map((x) => pick(x, "title", lang)))} />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(228,194,122,.25),transparent_60%)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-2 lg:pb-24 lg:pt-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-gold-300/60 bg-white/70 px-4 py-1.5 text-xs font-medium tracking-wide text-gold-700">
              {c.tagline}
            </p>
            <h1 className="text-4xl font-semibold leading-tight text-navy-700 sm:text-5xl lg:text-6xl">{c.promise}</h1>
            <p className="mt-5 text-xl text-teal-700">{c.heroTitle}</p>
            <p className="mt-4 max-w-xl text-base leading-8 text-ink-500">{c.heroText}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${lang}/book`} className="rounded-full bg-teal-700 px-7 py-3.5 font-medium text-white shadow-sm hover:bg-teal-900">{c.book}</Link>
              <Link href={`/${lang}/contact`} className="rounded-full border border-navy-700/20 bg-white px-7 py-3.5 font-medium text-navy-700 hover:border-teal-700">{c.callback}</Link>
            </div>
            {s("address") && <p className="mt-8 flex items-center gap-2 text-sm text-ink-500"><span className="h-1.5 w-1.5 rounded-full bg-gold-500" />{s("address")}</p>}
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <div className="aspect-[4/5] rounded-t-full border border-gold-300/50 bg-gradient-to-b from-white to-ivory-200 p-10 shadow-card">
              <div className="flex h-full flex-col items-center justify-center rounded-t-full border border-gold-300/40 bg-ivory-50 px-6">
                <Image src="/brand/emblem.png" alt={c.brand} width={300} height={189} priority className="w-full max-w-[280px]" />
                <p className="mt-8 text-center text-2xl font-semibold tracking-wide text-gold-700">{lang === "ar" ? "عيادات جولدن كير" : "GOLDEN CARE CLINICS"}</p>
                <Feathers className="mt-6 w-40" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Specialties */}
      {specialties.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <SectionTitle title={c.ourSpecialties} href={`/${lang}/specialties`} more={c.viewAll} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {specialties.map((sp) => (
              <Link key={sp.slug} href={`/${lang}/specialties/${sp.slug}`}
                className="group rounded-2xl border border-ivory-300/70 bg-white p-6 transition hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-card">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-700 transition group-hover:bg-teal-700 group-hover:text-white">
                  <SpecialtyIcon code={sp.code} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-navy-700">{pick(sp, "title", lang)}</h3>
                {pick(sp, "summary", lang) && <p className="mt-2 line-clamp-3 text-sm leading-7 text-ink-500">{pick(sp, "summary", lang)}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Offers */}
      {offers.length > 0 && (
        <section className="bg-white py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle title={c.currentOffers} href={`/${lang}/offers`} more={c.viewAll} />
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {offers.slice(0, 3).map((o) => <OfferCard key={o.slug} offer={o} lang={lang} />)}
            </div>
          </div>
        </section>
      )}

      {/* Doctors */}
      {doctors.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <SectionTitle title={c.ourDoctors} href={`/${lang}/doctors`} more={c.viewAll} />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.slice(0, 6).map((d) => <DoctorCard key={d.slug} doctor={d} lang={lang} />)}
          </div>
        </section>
      )}

      {/* Standards band */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-6 rounded-3xl bg-navy-700 p-8 text-ivory-100 sm:p-12 md:grid-cols-3">
          {(lang === "ar"
            ? [["مواعيد دقيقة", "حجز واضح وتذكير قبل الموعد وانتظار أقل."], ["ملف واحد لكل مريض", "تاريخك الطبي ومتابعاتك في مكان واحد لدى فريقك الطبي."], ["متابعة مستمرة", "فريق خدمة المرضى يتابع معك بعد الزيارة."]]
            : [["Accurate appointments", "Clear booking, reminders and shorter waits."], ["One file per patient", "Your history and follow-ups in one place for your care team."], ["Continuous follow-up", "Our patient experience team stays in touch after your visit."]]
          ).map(([h, p]) => (
            <div key={h}>
              <Feathers className="mb-4 w-16" />
              <h3 className="text-lg font-semibold text-gold-300">{h}</h3>
              <p className="mt-2 text-sm leading-7 text-ivory-300">{p}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function SectionTitle({ title, href, more }: { title: string; href: string; more: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-3xl font-semibold text-navy-700">{title}</h2>
        <Feathers className="mt-3 w-24" />
      </div>
      <Link href={href} className="text-sm font-medium text-teal-700 hover:underline">{more}</Link>
    </div>
  );
}
