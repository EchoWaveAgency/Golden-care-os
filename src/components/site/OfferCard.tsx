import Link from "next/link";
import type { Lang, Offer } from "@/lib/site/api";
import { pick } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";

export function OfferCard({ offer: o, lang }: { offer: Offer; lang: Lang }) {
  const c = copy(lang);
  const fmt = (n: number) => new Intl.NumberFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-EG").format(n);
  const until = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "long", timeZone: "Africa/Cairo" }).format(new Date(o.ends_at));
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-gold-300/50 bg-gradient-to-b from-white to-ivory-100">
      <div className="p-6">
        <h3 className="text-xl font-semibold text-navy-700">{pick(o, "title", lang)}</h3>
        {pick(o, "summary", lang) && <p className="mt-2 text-sm leading-7 text-ink-500">{pick(o, "summary", lang)}</p>}
        <p className="mt-5 flex items-baseline gap-2">
          <span className="num text-3xl font-semibold text-gold-700">{fmt(Number(o.price))}</span>
          <span className="text-sm text-gold-700">{c.egp}</span>
          {o.regular_price && <span className="text-sm text-ink-300 line-through"><span className="num">{fmt(Number(o.regular_price))}</span> {c.egp}</span>}
        </p>
        <p className="mt-2 text-xs text-ink-500">{c.validUntil} {until}</p>
      </div>
      <details className="mt-auto border-t border-gold-300/40 px-6 py-3 text-sm">
        <summary className="cursor-pointer text-teal-700">{c.terms}</summary>
        <p className="mt-2 whitespace-pre-wrap leading-7 text-ink-500">{pick(o, "terms", lang)}</p>
        {pick(o, "disclaimer", lang) && <p className="mt-2 text-xs text-ink-300">{pick(o, "disclaimer", lang)}</p>}
      </details>
      <div className="px-6 pb-6">
        <Link href={`/${lang}/book?offer=${o.slug}`} className="block rounded-full bg-teal-700 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-teal-900">{c.book}</Link>
      </div>
    </article>
  );
}
