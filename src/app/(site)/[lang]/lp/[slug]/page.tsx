import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getLanding, getSite, pick, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Feathers } from "@/components/site/Feathers";
import { InquiryForm } from "@/components/site/InquiryForm";
import { OfferCard } from "@/components/site/OfferCard";
import { DoctorCard } from "@/components/site/DoctorCard";
import { Countdown } from "@/components/site/Countdown";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { anonClient } from "@/lib/site/api";

export const dynamic = "force-dynamic";   // the A/B version depends on the visitor
export async function generateMetadata({ params }: { params: { lang: Lang; slug: string } }): Promise<Metadata> {
  const l = await getLanding(params.slug).catch(() => null);
  if (!l) return { robots: { index: false } };
  return { title: pick(l, "title", params.lang), description: pick(l, "hero", params.lang) || undefined,
    alternates: { canonical: `/${params.lang}/lp/${params.slug}`, languages: { ar: `/ar/lp/${params.slug}`, en: `/en/lp/${params.slug}` } } };
}
export default async function Landing({ params }: { params: { lang: Lang; slug: string } }) {
  const lang = params.lang; const c = copy(lang);
  const [l0, site] = await Promise.all([getLanding(params.slug).catch(() => null), getSite().catch(() => ({}))]);
  const l = l0 ? structuredClone(l0) : null;
  if (!l) notFound();  // expired, archived or unapproved pages disappear automatically
  // A/B: version B (if any) for a stable share of visitors, decided by their anonymous id.
  const vid = cookies().get("gc_vid")?.value;
  const vb = (l.variants ?? [])[0];
  const bucket = vid ? parseInt(createHash("sha256").update(`${l.slug}:${vid}`).digest("hex").slice(0, 8), 16) % 100 : 0;
  const variant = vb && vid && bucket < (vb.weight ?? 50) ? "B" : "A";
  if (variant === "B" && vb) Object.assign(l, { title_ar: vb.title_ar, title_en: vb.title_en ?? vb.title_ar, hero_ar: vb.hero_ar ?? l.hero_ar, hero_en: vb.hero_en ?? l.hero_en });
  if (vid && vb) await anonClient().rpc("public_landing_event", { p_slug: l.slug, p_variant: variant, p_kind: "view", p_visitor: vid });
  const wa = setting(site, "whatsapp", lang)?.replace(/\D/g, "");
  const faq = (l.faq ?? []).map((f) => ({ q: lang === "ar" ? f.q_ar : f.q_en, a: lang === "ar" ? f.a_ar : f.a_en })).filter((f) => f.q);
  return (
    <>
      <section className="relative overflow-hidden bg-navy-700 text-ivory-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(184,135,47,.35),transparent_55%)]" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-5 lg:py-24">
          <div className="lg:col-span-3">
            <Feathers className="mb-6 w-24" />
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">{pick(l, "title", lang)}</h1>
            {pick(l, "hero", lang) && <p className="mt-5 max-w-2xl text-lg leading-8 text-ivory-200">{pick(l, "hero", lang)}</p>}
            {l.benefits.length > 0 && (
              <ul className="mt-8 space-y-3">
                {l.benefits.map((b, i) => <li key={i} className="flex gap-3"><span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold-300" />{lang === "ar" ? b.ar : b.en}</li>)}
              </ul>
            )}
            {l.show_countdown && l.ends_at && <div className="mt-8"><Countdown endsAt={l.ends_at} lang={lang} /></div>}
          </div>
          <div className="rounded-2xl bg-white p-6 text-ink shadow-card lg:col-span-2">
            <h2 className="mb-4 text-xl font-semibold text-navy-700">{l.cta_variant === "book" ? c.book : c.callback}</h2>
            <Suspense><InquiryForm lang={lang} kind={l.cta_variant === "book" ? "booking" : "callback"} landingSlug={l.slug} abVariant={vb ? variant : undefined} offerSlug={l.offer?.slug} specialtySlug={l.specialty_slug ?? undefined} compact /></Suspense>
            {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="mt-3 block rounded-full border border-[#1f8f5f]/40 px-5 py-2.5 text-center text-sm text-[#1f8f5f]">{c.whatsapp}</a>}
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl space-y-14 px-4 py-14 sm:px-6">
        {pick(l, "body", lang) && <p className="max-w-3xl whitespace-pre-wrap leading-8">{pick(l, "body", lang)}</p>}
        {l.offer && <div className="max-w-md"><OfferCard offer={l.offer} lang={lang} /></div>}
        {l.doctors.length > 0 && <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{l.doctors.map((d) => <DoctorCard key={d.slug} doctor={d} lang={lang} />)}</div>}
        {faq.length > 0 && (
          <div className="max-w-3xl space-y-2">
            <h2 className="mb-4 text-2xl font-semibold text-navy-700">{c.faq}</h2>
            {faq.map((f, i) => <details key={i} className="rounded-xl border border-ivory-300/70 bg-white px-5 py-4"><summary className="cursor-pointer font-medium text-navy-700">{f.q}</summary><p className="mt-2 text-sm leading-7 text-ink-500">{f.a}</p></details>)}
          </div>
        )}
        <p className="max-w-3xl rounded-xl border border-ivory-300 bg-ivory-100 p-4 text-xs leading-6 text-ink-500">{c.medicalNote}</p>
      </div>
    </>
  );
}
