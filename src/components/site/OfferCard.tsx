import Link from "next/link";
import type { Lang, Offer } from "@/lib/site/api";
import { pick } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";

// An approved offer shown as a clinic ticket: details on one side, price stub on the other, a perforation between.
export function OfferCard({ offer: o, lang }: { offer: Offer; lang: Lang }) {
  const c = copy(lang);
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG").format(n);
  const until = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "long", timeZone: "Africa/Cairo" }).format(new Date(o.ends_at));
  return (
    <article className="relative flex flex-col overflow-hidden rounded-2xl border border-gold-300/60 bg-white sm:flex-row">
      <div className="flex-1 p-6">
        <h3 className="text-xl font-semibold leading-snug text-navy-700">{pick(o, "title", lang)}</h3>
        {pick(o, "summary", lang) && <p className="mt-2 text-[15px] leading-7 text-ink-500">{pick(o, "summary", lang)}</p>}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-teal-700">{c.terms}</summary>
          <p className="mt-2 whitespace-pre-wrap leading-7 text-ink-500">{pick(o, "terms", lang)}</p>
          {pick(o, "disclaimer", lang) && <p className="mt-2 text-xs text-ink-300">{pick(o, "disclaimer", lang)}</p>}
        </details>
      </div>
      {/* perforation */}
      <div className="relative h-0 border-t-2 border-dashed border-gold-300/70 sm:h-auto sm:border-s-2 sm:border-t-0" aria-hidden="true">
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border border-gold-300/60 bg-ivory-50 sm:left-1/2 sm:-top-3 sm:-translate-x-1/2" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full border border-gold-300/60 bg-ivory-50 sm:-bottom-3 sm:left-1/2 sm:right-auto sm:top-auto sm:-translate-x-1/2" />
      </div>
      <div className="flex flex-col justify-between gap-4 bg-ivory-50 p-6 sm:w-60">
        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="num text-4xl font-bold text-ember">{fmt(Number(o.price))}</span>
            <span className="text-sm font-medium text-ember">{c.egp}</span>
          </p>
          {o.regular_price && <p className="mt-1 text-sm text-ink-300">{c.regular} <s><span className="num">{fmt(Number(o.regular_price))}</span> {c.egp}</s></p>}
          <p className="mt-3 text-xs leading-6 text-ink-500">{c.validUntil} {until}</p>
        </div>
        <Link href={`/${lang}/book?offer=${o.slug}`} className="block whitespace-nowrap rounded-full bg-teal-700 px-5 py-2.5 text-center text-sm font-medium text-white transition hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2">{c.book}</Link>
      </div>
    </article>
  );
}
