import type { Metadata } from "next";
import { Suspense } from "react";
import { getSite, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { InquiryForm } from "@/components/site/InquiryForm";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).contact, alternates: { canonical: `/${params.lang}/contact`, languages: { ar: "/ar/contact", en: "/en/contact" } } };
}
export default async function Contact({ params }: { params: { lang: Lang } }) {
  const lang = params.lang; const c = copy(lang);
  const site = await getSite().catch(() => ({}));
  const s = (k: string) => setting(site, k, lang);
  const wa = s("whatsapp")?.replace(/\D/g, "");
  return (
    <>
      <PageHero title={c.contact} />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-5">
        <div className="space-y-5 md:col-span-2">
          {s("address") && <Info label={c.address} value={s("address")!} />}
          {s("hours") && <Info label={c.hours} value={s("hours")!} />}
          {s("mobile") && <Info label={c.callUs} value={<a href={`tel:${s("mobile")}`} className="num text-teal-700">{s("mobile")}</a>} />}
          {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="block rounded-full bg-[#1f8f5f] px-5 py-3 text-center font-medium text-white">{c.whatsapp}</a>}
          {s("map_url") && <a href={s("map_url")!} target="_blank" rel="noopener" className="block rounded-full border border-navy-700/20 px-5 py-3 text-center text-navy-700">{c.openMap}</a>}
        </div>
        <div className="rounded-2xl border border-ivory-300/70 bg-white p-6 shadow-card md:col-span-3">
          <h2 className="mb-4 text-xl font-semibold text-navy-700">{c.callback}</h2>
          <Suspense><InquiryForm lang={lang} kind="callback" showMessage /></Suspense>
        </div>
      </div>
    </>
  );
}
function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-ivory-300/70 bg-white p-5"><p className="text-xs text-ink-300">{label}</p><div className="mt-1 leading-7 text-navy-700">{value}</div></div>;
}
