import Image from "next/image";
import Link from "next/link";
import { displayPhone, getDoctors, getOffers, getSite, getSpecialties, getTestimonials, pick, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Feathers } from "@/components/site/Feathers";
import { SpecialtyDirectory } from "@/components/site/SpecialtyDirectory";
import { DoctorCard } from "@/components/site/DoctorCard";
import { OfferCard } from "@/components/site/OfferCard";
import { JsonLd, clinicJsonLd } from "@/components/site/JsonLd";

export const revalidate = 60;

export default async function Home({ params }: { params: { lang: Lang } }) {
  const lang = params.lang;
  const ar = lang === "ar";
  const c = copy(lang);
  const [site, specialties, doctors, offers, testimonials] = await Promise.all([
    getSite().catch(() => ({})), getSpecialties().catch(() => []), getDoctors().catch(() => []), getOffers().catch(() => []), getTestimonials().catch(() => []),
  ]);
  const s = (k: string) => setting(site, k, lang);
  const whatsapp = s("whatsapp")?.replace(/\D/g, "") || null;
  const n = new Intl.NumberFormat(ar ? "ar-EG" : "en-EG").format(specialties.length);

  const steps: [string, string][] = ar
    ? [["اختار التخصص والميعاد", "من الموقع أو واتساب أو بالتليفون، في أقل من دقيقة."],
       ["فريقنا يأكد معاك", "خدمة المرضى بتتصل تأكد الميعاد وتقولك تجهّز إيه قبل الزيارة."],
       ["زيارتك في ميعادها", "ملف واحد ليك عند كل الأطباء، فمش هتعيد حكايتك من الأول."],
       ["متابعة بعد الزيارة", "تذكير بالمتابعة والنتائج توصلك أول ما الدكتور يعتمدها."]]
    : [["Choose a specialty and time", "On the website, WhatsApp or by phone, in under a minute."],
       ["We confirm with you", "Our patient team calls to confirm and tells you how to prepare."],
       ["Your visit, on time", "One file shared by all your doctors, so you never start over."],
       ["Follow-up after the visit", "Reminders for follow-ups, and results as soon as your doctor releases them."]];

  return (
    <>
      <JsonLd data={clinicJsonLd(lang, s("address"), s("mobile"), specialties.map((x) => pick(x, "title", lang)))} />

      {/* Hero: words on one side, the falcon inside a temple arch on the other, its wing running off the page edge */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.1fr_.9fr] lg:pb-20 lg:pt-16">
          <div className="relative z-10">
            <p className="text-[15px] font-medium text-gold-700">{c.tagline}</p>
            <h1 className="mt-3 text-[2.6rem] font-bold leading-[1.25] text-navy-700 sm:text-6xl lg:text-[4.25rem]">{c.promise}</h1>
            <p className="mt-5 max-w-xl text-lg leading-9 text-ink-500">
              {ar
                ? `${n} تخصصات طبية وتجميلية تحت سقف واحد في مدينة الشروق، بمواعيد واضحة وملف واحد لكل مريض ومتابعة بعد الزيارة.`
                : `${n} medical and aesthetic specialties under one roof in El Shorouk, with clear appointments, one file per patient and follow-up after your visit.`}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${lang}/book`} className="rounded-full bg-teal-700 px-8 py-4 text-base font-semibold text-white shadow-[0_8px_24px_-8px_rgba(15,94,99,.6)] transition hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2">{c.book}</Link>
              {whatsapp ? (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener" className="rounded-full border border-navy-700/20 bg-white px-7 py-4 text-base font-medium text-navy-700 hover:border-teal-700">{c.whatsapp}</a>
              ) : (
                <Link href={`/${lang}/contact`} className="rounded-full border border-navy-700/20 bg-white px-7 py-4 text-base font-medium text-navy-700 hover:border-teal-700">{c.callback}</Link>
              )}
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-1 gap-x-8 gap-y-4 border-t border-navy-700/10 pt-6 text-sm sm:grid-cols-2">
              {s("address") && (
                <div><dt className="text-ink-300">{c.address}</dt><dd className="mt-1 font-medium leading-7 text-navy-700">{s("address")}</dd></div>
              )}
              {s("hours") && (
                <div><dt className="text-ink-300">{c.hours}</dt><dd className="mt-1 font-medium leading-7 text-navy-700">{s("hours")}</dd></div>
              )}
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-[460px] lg:max-w-none" aria-hidden="true">
            <div className="relative aspect-square overflow-hidden sm:aspect-[5/6] rounded-t-[999px] bg-navy-700 lg:-me-24 xl:-me-40">
              <div className="absolute inset-3 rounded-t-[999px] border border-gold-300/30" />
              <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-navy-900/70 to-transparent" />
              <Image src="/brand/emblem-hd.png" alt="" width={1601} height={847} priority sizes="(min-width:1024px) 440px, 80vw"
                className="gc-rise absolute left-1/2 top-[42%] w-[80%] max-w-[440px] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_20px_30px_rgba(0,0,0,.35)]" />
              <div className="absolute inset-x-0 bottom-8 text-center">
                <p className="text-2xl font-bold text-gold-300">{ar ? "عيادات جولدن كير" : "Golden Care Clinics"}</p>
                <p className="mt-1 text-sm text-ivory-300">{ar ? "مدينة الشروق" : "El Shorouk City"}</p>
              </div>
            </div>
            <Feathers className="absolute -bottom-3 start-8 w-40" />
          </div>
        </div>
      </section>

      {/* Quick finder: one tap from "what do I need" to the right booking form */}
      {specialties.length > 0 && (
        <section className="border-y border-navy-700/10 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:gap-8">
            <h2 className="shrink-0 text-lg font-semibold text-navy-700">{ar ? "محتاج تحجز في إيه؟" : "What do you need?"}</h2>
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
              {specialties.map((sp) => (
                <li key={sp.slug} className="shrink-0">
                  <Link href={`/${lang}/book?specialty=${sp.slug}`}
                    className="block whitespace-nowrap rounded-full border border-teal-700/25 px-4 py-2 text-sm text-teal-700 transition hover:border-teal-700 hover:bg-teal-700 hover:text-white">
                    {pick(sp, "title", lang)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Specialties directory */}
      {specialties.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionTitle title={c.ourSpecialties}
            lead={ar ? "من الجلدية والليزر والأسنان لحد الجراحات الدقيقة والتغذية العلاجية." : "From dermatology, laser and dentistry to specialist surgery and clinical nutrition."}
            href={`/${lang}/specialties`} more={c.viewAll} />
          <SpecialtyDirectory list={specialties} lang={lang} />
        </section>
      )}

      {/* Offers as tickets */}
      {offers.length > 0 && (
        <section className="border-y border-navy-700/10 bg-ivory-50 py-16 lg:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <SectionTitle title={c.currentOffers} href={`/${lang}/offers`} more={c.viewAll} />
            <div className="grid gap-6 lg:grid-cols-2">
              {offers.slice(0, 2).map((o) => <OfferCard key={o.slug} offer={o} lang={lang} />)}
            </div>
            <p className="mt-4 text-xs leading-6 text-ink-500">{c.medicalNote}</p>
          </div>
        </section>
      )}

      {/* Doctors */}
      {doctors.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <SectionTitle title={c.ourDoctors} href={`/${lang}/doctors`} more={c.viewAll} />
          <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.slice(0, 6).map((d) => <DoctorCard key={d.slug} doctor={d} lang={lang} />)}
          </div>
        </section>
      )}

      {/* How a visit works — real, ordered steps */}
      <section className="bg-navy-700 text-ivory-100">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">{ar ? "زيارتك معانا خطوة بخطوة" : "Your visit, step by step"}</h2>
          <Feathers className="mt-4 w-24" />
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([h, p], i) => (
              <li key={h} className="relative border-t border-white/15 pt-6">
                <span className="num absolute -top-4 start-0 grid h-8 w-8 place-items-center rounded-full bg-gold-500 text-sm font-bold text-navy-900">
                  {new Intl.NumberFormat(ar ? "ar-EG" : "en").format(i + 1)}
                </span>
                <h3 className="text-lg font-semibold text-gold-300">{h}</h3>
                <p className="mt-2 text-[15px] leading-7 text-ivory-300">{p}</p>
              </li>
            ))}
          </ol>
          <Link href={`/${lang}/book`} className="mt-12 inline-block rounded-full bg-white px-8 py-4 font-semibold text-teal-700 transition hover:bg-ivory-100">{c.book}</Link>
        </div>
      </section>

      {testimonials.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-20" data-testimonials>
          <h2 className="text-3xl font-bold text-navy-700">{ar ? "آراء مرضانا" : "What our patients say"}</h2>
          <Feathers className="mt-4 w-24" />
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <figure key={i}>
                {t.rating ? <p className="mb-3 text-lg text-gold-500" aria-label={`${t.rating}/5`}>{"★".repeat(t.rating)}</p> : null}
                <blockquote className="text-lg leading-9 text-navy-700">«{ar ? t.quote_ar : t.quote_en}»</blockquote>
                <figcaption className="mt-3 text-sm text-ink-500">— {ar ? t.name_ar : t.name_en}</figcaption>
              </figure>))}
          </div>
          <p className="mt-6 text-xs text-ink-300">{ar ? "تُنشر الآراء بموافقة كتابية من المرضى، والنتائج تختلف من شخص لآخر." : "Published with patients' written consent. Results vary from person to person."}</p>
        </section>)}

      {/* Visit us */}
      {(s("address") || s("hours")) && (
        <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:pt-20">
          <div className="grid overflow-hidden rounded-3xl border border-gold-300/50 bg-white lg:grid-cols-[1fr_1.1fr]">
            <div className="p-8 sm:p-12">
              <h2 className="text-3xl font-bold text-navy-700">{c.visitUs}</h2>
              <Feathers className="mt-4 w-24" />
              <dl className="mt-8 space-y-6">
                {s("address") && <div><dt className="text-sm text-ink-300">{c.address}</dt><dd className="mt-1 text-lg font-medium leading-8 text-navy-700">{s("address")}</dd></div>}
                {s("hours") && <div><dt className="text-sm text-ink-300">{c.hours}</dt><dd className="mt-1 text-lg font-medium leading-8 text-navy-700">{s("hours")}</dd></div>}
                {s("mobile") && <div><dt className="text-sm text-ink-300">{c.callUs}</dt><dd className="mt-1 text-lg font-medium"><a href={`tel:${s("mobile")}`} className="num text-teal-700 hover:underline">{displayPhone(s("mobile"))}</a></dd></div>}
              </dl>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={`/${lang}/book`} className="rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-900">{c.book}</Link>
                {s("map_url") && <a href={s("map_url")!} target="_blank" rel="noopener" className="rounded-full border border-navy-700/20 px-6 py-3 text-sm font-medium text-navy-700 hover:border-teal-700">{c.openMap}</a>}
              </div>
            </div>
            <div className="relative min-h-[260px] overflow-hidden bg-ivory-200" aria-hidden="true">
              <Image src="/brand/logo-full.png" alt="" fill sizes="(min-width:1024px) 40vw, 90vw" className="object-contain p-10 sm:p-14" />
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function SectionTitle({ title, lead, href, more }: { title: string; lead?: string; href: string; more: string }) {
  return (
    <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h2 className="text-3xl font-bold text-navy-700 sm:text-4xl">{title}</h2>
        <Feathers className="mt-4 w-24" />
        {lead && <p className="mt-4 text-lg leading-8 text-ink-500">{lead}</p>}
      </div>
      <Link href={href} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline">
        {more}
        <svg viewBox="0 0 24 24" className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Link>
    </div>
  );
}
