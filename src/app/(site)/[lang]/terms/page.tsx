import type { Metadata } from "next";
import type { Lang } from "@/lib/site/api";
import { LEGAL } from "@/lib/site/legal";
import { LegalPage } from "@/components/site/LegalPage";

export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: LEGAL.terms[params.lang].title, alternates: { canonical: `/${params.lang}/terms` } };
}
export default function Page({ params }: { params: { lang: Lang } }) {
  return <LegalPage lang={params.lang} doc="terms" />;
}
