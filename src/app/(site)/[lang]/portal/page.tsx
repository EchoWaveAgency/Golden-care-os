import type { Metadata } from "next";
import { getSite, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";

export const metadata: Metadata = { robots: { index: false } };
export default async function Portal({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang);
  const wa = setting(await getSite().catch(() => ({})), "whatsapp", params.lang)?.replace(/\D/g, "");
  return (
    <>
      <PageHero title={c.portal} subtitle={c.portalSoon} />
      {wa && <div className="mx-auto max-w-3xl px-4 py-10"><a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" className="inline-block rounded-full bg-[#1f8f5f] px-6 py-3 text-white">{c.whatsapp}</a></div>}
    </>
  );
}
