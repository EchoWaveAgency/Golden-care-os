"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";

export function SiteHeader({ lang, whatsapp }: { lang: Lang; whatsapp: string | null }) {
  const path = usePathname() ?? `/${lang}`;
  const c = copy(lang);
  const other = lang === "ar" ? "en" : "ar";
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (menu.current) menu.current.open = false; }, [path]);
  const links: [string, string][] = [[`/${lang}/specialties`, c.specialties], [`/${lang}/doctors`, c.doctors], [`/${lang}/offers`, c.offers], [`/${lang}/articles`, lang === "ar" ? "مقالات طبية" : "Health articles"], [`/${lang}/about`, c.about], [`/${lang}/contact`, c.contact]];
  const switchHref = path.replace(/^\/(ar|en)/, `/${other}`);
  return (
    <header className="no-print sticky top-0 z-30 border-b border-navy-700/10 bg-ivory-50/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href={`/${lang}`} className="flex items-center gap-3" aria-label={c.brand}>
          <Image src="/brand/emblem.png" alt="" width={56} height={35} priority className="h-auto w-12 sm:w-14" />
          <span className="leading-tight">
            {lang === "ar" ? (
              <>
                <span className="block text-lg font-bold text-gold-700">جولدن كير</span>
                <span className="block text-xs text-ink-500">عيادات · مدينة الشروق</span>
              </>
            ) : (
              <>
                <span className="block text-lg font-bold tracking-wide text-gold-700">GOLDEN CARE</span>
                <span className="block text-[11px] tracking-[0.18em] text-ink-500">CLINICS · EL SHOROUK</span>
              </>
            )}
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-[15px] lg:flex" aria-label={lang === "ar" ? "القائمة الرئيسية" : "Main"}>
          {links.map(([href, label]) => {
            const on = path.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={on ? "page" : undefined}
                className={`relative py-1 transition-colors hover:text-teal-700 ${on ? "font-semibold text-teal-700 after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-gold-500" : "text-navy-700"}`}>{label}</Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Link href={switchHref} hrefLang={other} lang={other} className="hidden rounded-full px-3 py-2 text-sm text-ink-500 hover:text-teal-700 sm:block">{c.langSwitch}</Link>
          {whatsapp && (
            <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener" className="hidden rounded-full border border-teal-700/30 px-4 py-2 text-sm text-teal-700 hover:bg-teal-50 lg:block">{c.whatsapp}</a>
          )}
          <Link href={`/${lang}/book`} className="hidden rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-900 sm:block">{c.book}</Link>
          <details ref={menu} className="group relative lg:hidden">
            <summary className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full border border-navy-700/15 text-navy-700 [&::-webkit-details-marker]:hidden"
              aria-label={lang === "ar" ? "القائمة" : "Menu"}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 group-open:hidden" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" /></svg>
              <svg viewBox="0 0 24 24" className="hidden h-5 w-5 group-open:block" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" /></svg>
            </summary>
            <div className="fixed inset-x-0 top-[68px] border-b border-navy-700/10 bg-ivory-50 px-4 pb-6 pt-2 shadow-[0_20px_40px_-20px_rgba(20,48,74,.25)]">
              <ul className="divide-y divide-navy-700/10">
                {links.map(([href, label]) => (
                  <li key={href}><Link href={href} className={`block py-3.5 text-lg ${path.startsWith(href) ? "font-semibold text-teal-700" : "text-navy-700"}`}>{label}</Link></li>
                ))}
                <li><Link href={switchHref} hrefLang={other} lang={other} className="block py-3.5 text-lg text-ink-500">{c.langSwitch}</Link></li>
              </ul>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
