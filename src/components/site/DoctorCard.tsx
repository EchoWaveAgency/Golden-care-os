import Link from "next/link";
import type { Doctor, Lang } from "@/lib/site/api";
import { pick } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Monogram } from "./Monogram";

export function DoctorCard({ doctor: d, lang }: { doctor: Doctor; lang: Lang }) {
  const c = copy(lang);
  const name = lang === "ar" ? d.name_ar : d.name_en;
  const specialty = lang === "ar" ? d.specialty.name_ar : d.specialty.name_en;
  return (
    <article className="group flex flex-col border-t-2 border-gold-300/70 pt-6 transition-colors hover:border-teal-700">
      <div className="flex items-center gap-4">
        {d.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.photo_url} alt={name} className="h-20 w-20 rounded-full object-cover ring-2 ring-gold-300 ring-offset-2 ring-offset-ivory-100" />
        ) : <Monogram name={name} />}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-navy-700">{name}</h3>
          <p className="text-sm text-teal-700">{pick(d, "title", lang) || specialty}</p>
        </div>
      </div>
      {pick(d, "bio", lang) && <p className="mt-4 line-clamp-3 flex-1 text-[15px] leading-7 text-ink-500">{pick(d, "bio", lang)}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {d.accepts_online_booking && <Link href={`/${lang}/book?doctor=${d.slug}`} className="rounded-full bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-900">{c.book}</Link>}
        <Link href={`/${lang}/doctors/${d.slug}`} className="rounded-full border border-navy-700/15 px-4 py-2 text-sm text-navy-700 hover:border-teal-700">{c.viewProfile}</Link>
      </div>
    </article>
  );
}
