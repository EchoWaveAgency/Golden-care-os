import Link from "next/link";
import { pick, type Lang, type SpecialtyCard } from "@/lib/site/api";
import { SpecialtyIcon } from "./SpecialtyIcon";

// The specialties as a clinic directory (like the board at a clinic entrance), not a grid of identical cards.
export function SpecialtyDirectory({ list, lang }: { list: SpecialtyCard[]; lang: Lang }) {
  return (
    <ul className="grid border-t border-navy-700/10 md:grid-cols-2 md:gap-x-12">
      {list.map((s) => (
        <li key={s.slug} className="border-b border-navy-700/10">
          <Link href={`/${lang}/specialties/${s.slug}`}
            className="group flex items-start gap-4 py-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 sm:py-6">
            <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-300/70 text-gold-700 transition-colors group-hover:border-teal-700 group-hover:bg-teal-700 group-hover:text-white">
              <SpecialtyIcon code={s.code} className="h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold text-navy-700 group-hover:text-teal-700">{pick(s, "title", lang)}</span>
              {pick(s, "summary", lang) && <span className="mt-1 block text-[15px] leading-7 text-ink-500">{pick(s, "summary", lang)}</span>}
            </span>
            <svg viewBox="0 0 24 24" className="mt-3 h-5 w-5 shrink-0 text-ink-300 transition group-hover:text-teal-700 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
              <path d="M5 12h14m-5-5 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </li>
      ))}
    </ul>
  );
}
