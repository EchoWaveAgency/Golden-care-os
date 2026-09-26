import type { Metadata } from "next";
import { getDoctors, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { DoctorCard } from "@/components/site/DoctorCard";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).doctors, alternates: { canonical: `/${params.lang}/doctors`, languages: { ar: "/ar/doctors", en: "/en/doctors" } } };
}
export default async function Doctors({ params }: { params: { lang: Lang } }) {
  const c = copy(params.lang);
  const list = await getDoctors().catch(() => []);
  return (
    <>
      <PageHero title={c.ourDoctors} />
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {list.map((d) => <DoctorCard key={d.slug} doctor={d} lang={params.lang} />)}
      </div>
    </>
  );
}
