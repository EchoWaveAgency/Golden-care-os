"use client";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";

export function SiteHeader({ lang, whatsapp }: { lang: Lang; whatsapp: string | null }) {
  const path = usePathname() ?? `/${lang}`;
  const c = copy(lang);
  const other = lang === "ar" ? "en" : "ar";
  const links: [string, string][] = [[`/${lang}/specialties`, c.specialties], [`/${lang}/doctors`, c.doctors], [`/${lang}/offers`, c.offers], [`/${lang}/about`, c.about], [`/${lang}/contact`, c.contact]];
  return (
    <header className="no-print sticky top-0 z-30 border-b border-ivory-300/60 bg-ivory-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={`/${lang}`} className="flex items-center gap-3" aria-label={c.brand}>
          <Image src="/brand/emblem.png" alt="" width={56} height={35} priority />
          <span className="leading-tight">
            <span className="block text-lg font-semibold tracking-wide text-gold-700">{lang === "ar" ? "جولدن كير" : "GOLDEN CARE"}</span>
            <span className="block text-[11px] tracking-[0.18em] text-ink-500">{lang === "ar" ? "عيادات · مدينة الشروق" : "CLINICS · EL SHOROUK"}</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm lg:flex" aria-label="main">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={`transition hover:text-teal-700 ${path.startsWith(href) ? "font-semibold text-teal-700" : "text-navy-700"}`}>{label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href={path.replace(/^\/(ar|en)/, `/${other}`)} hrefLang={other} className="hidden rounded-full px-3 py-2 text-sm text-ink-500 hover:text-teal-700 sm:block">{c.langSwitch}</Link>
          {whatsapp && (
            <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener" className="hidden rounded-full border border-teal-700/30 px-4 py-2 text-sm text-teal-700 hover:bg-teal-50 md:block">{c.whatsapp}</a>
          )}
          <Link href={`/${lang}/book`} className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-900">{c.book}</Link>
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-3 text-sm lg:hidden" aria-label="mobile">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={`whitespace-nowrap ${path.startsWith(href) ? "font-semibold text-teal-700" : "text-navy-700"}`}>{label}</Link>
        ))}
        <Link href={path.replace(/^\/(ar|en)/, `/${other}`)} className="whitespace-nowrap text-ink-500">{c.langSwitch}</Link>
      </nav>
    </header>
  );
}
