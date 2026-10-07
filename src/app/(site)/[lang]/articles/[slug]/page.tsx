import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticle, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { dateTime } from "@/lib/format";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang; slug: string } }): Promise<Metadata> {
  const a = await getArticle(params.slug).catch(() => null);
  if (!a) return { robots: { index: false } };
  return { title: params.lang === "ar" ? a.title_ar : a.title_en, description: (params.lang === "ar" ? a.summary_ar : a.summary_en) ?? undefined,
    alternates: { canonical: `/${params.lang}/articles/${params.slug}`, languages: { ar: `/ar/articles/${params.slug}`, en: `/en/articles/${params.slug}` } } };
}
export default async function ArticlePage({ params }: { params: { lang: Lang; slug: string } }) {
  const lang = params.lang; const ar = lang === "ar"; const c = copy(lang);
  const a = await getArticle(params.slug).catch(() => null);
  if (!a) notFound();
  const body = (ar ? a.body_ar : a.body_en ?? a.body_ar) ?? "";
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6" data-article>
      <h1 className="text-3xl font-semibold leading-tight text-navy-700">{ar ? a.title_ar : a.title_en}</h1>
      <p className="mt-2 text-sm text-ink-500">{a.author ? `${ar ? a.author.name_ar : a.author.name_en} · ` : ""}{dateTime(a.published_at, lang, { dateStyle: "long", timeStyle: undefined })}{a.reading_minutes ? ` · ${ar ? `${a.reading_minutes} دقائق` : `${a.reading_minutes} min`}` : ""}</p>
      {(ar ? a.summary_ar : a.summary_en) && <p className="mt-6 text-lg leading-8 text-ink-500">{ar ? a.summary_ar : a.summary_en}</p>}
      <div className="mt-6 whitespace-pre-wrap leading-8">{body}</div>
      {a.sources && <p className="mt-8 whitespace-pre-wrap rounded-xl bg-ivory-100 p-4 text-xs leading-6 text-ink-500">{ar ? "المصادر: " : "Sources: "}{a.sources}</p>}
      <p className="mt-6 rounded-xl border border-ivory-300 bg-ivory-100 p-4 text-xs leading-6 text-ink-500">{c.medicalNote}</p>
    </article>
  );
}
