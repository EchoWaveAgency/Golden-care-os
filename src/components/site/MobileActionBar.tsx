"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { trackConversion } from "./Consent";

// Phones only: the three ways to reach the clinic stay under the thumb. Hidden on the booking page itself.
export function MobileActionBar({ lang, whatsapp, mobile }: { lang: Lang; whatsapp: string | null; mobile: string | null }) {
  const path = usePathname() ?? "";
  const c = copy(lang);
  if (/\/(book|portal)(\/|$)/.test(path)) return null;
  const item = "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium";
  return (
    <>
      <div className="h-16 lg:hidden" aria-hidden="true" />
      <nav aria-label={lang === "ar" ? "تواصل سريع" : "Quick contact"}
        className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-navy-700/10 bg-ivory-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <Link href={`/${lang}/book`} className={`${item} m-1.5 rounded-xl bg-teal-700 text-white`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4m8-4v4M3.5 10h17" strokeLinecap="round" /></svg>
          {c.book}
        </Link>
        {whatsapp ? (
          <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener" onClick={() => trackConversion("whatsapp_click")} className={`${item} text-[#1f8f5f]`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Z" /></svg>
            {c.whatsapp}
          </a>
        ) : (
          <Link href={`/${lang}/contact`} className={`${item} text-teal-700`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h2.2l1.6 4-2 1.3a11 11 0 0 0 7.4 7.4l1.3-2 4 1.6v2.2a1.5 1.5 0 0 1-1.5 1.5A16 16 0 0 1 4 5.5Z" strokeLinejoin="round" /></svg>
            {c.callback}
          </Link>
        )}
        {mobile && (
          <a href={`tel:${mobile}`} className={`${item} text-navy-700`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h2.2l1.6 4-2 1.3a11 11 0 0 0 7.4 7.4l1.3-2 4 1.6v2.2a1.5 1.5 0 0 1-1.5 1.5A16 16 0 0 1 4 5.5Z" strokeLinejoin="round" /></svg>
            {c.callUs}
          </a>
        )}
      </nav>
    </>
  );
}
