import type { Metadata } from "next";
import Link from "next/link";
import { getArticles, type Lang } from "@/lib/site/api";
import { PageHero } from "@/components/site/PageHero";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  const ar = params.lang === "ar";
  return { title: ar ? "مقالات طبية" : "Health articles", alternates: { canonical: `/${params.lang}/articles`, languages: { ar: "/ar/articles", en: "/en/articles" } } };
}
export default async function Articles({ params }: { params: { lang: Lang } }) {
  const lang = params.lang; const ar = lang === "ar";
  const [articles, instructions] = await Promise.all([getArticles("article").catch(() => []), getArticles("instruction").catch(() => [])]);
  const Card = ({ a }: { a: (typeof articles)[number] }) => (
    <Link href={`/${lang}/articles/${a.slug}`} className="block rounded-2xl border border-ivory-300/70 bg-white p-5 transition hover:shadow-card">
      <h2 className="font-semibold text-navy-700">{ar ? a.title_ar : a.title_en}</h2>
      {(ar ? a.summary_ar : a.summary_en) && <p className="mt-2 text-sm leading-7 text-ink-500">{ar ? a.summary_ar : a.summary_en}</p>}
      {a.reading_minutes && <p className="mt-3 text-xs text-ink-300">{ar ? `${a.reading_minutes} دقائق قراءة` : `${a.reading_minutes} min read`}</p>}
    </Link>);
  return (
    <>
      <PageHero title={ar ? "مقالات طبية وتعليمات" : "Health articles & instructions"} subtitle={ar ? "كل محتوى هنا راجعه أطباء جولدن كير. لا يغني عن استشارة الطبيب." : "Every piece here is reviewed by Golden Care doctors. It does not replace a consultation."} />
      <div className="mx-auto max-w-7xl space-y-10 px-4 py-12 sm:px-6">
        <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-articles>
          {articles.length === 0 ? <p className="text-ink-500">{ar ? "لا توجد مقالات منشورة بعد." : "No articles yet."}</p> : articles.map((a) => <Card key={a.slug} a={a} />)}
        </section>
        {instructions.length > 0 && (
          <section>
            <h2 className="mb-4 text-2xl font-semibold text-navy-700">{ar ? "تعليمات قبل وبعد الجلسات" : "Before & after your session"}</h2>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{instructions.map((a) => <Card key={a.slug} a={a} />)}</div>
          </section>)}
      </div>
    </>
  );
}
