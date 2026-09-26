import type { Metadata } from "next";
import type { Lang } from "@/lib/site/api";
import { LEGAL } from "@/lib/site/legal";
import { LegalPage } from "@/components/site/LegalPage";

export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: LEGAL.communication[params.lang].title, alternates: { canonical: `/${params.lang}/communication-consent` } };
}
export default function Page({ params }: { params: { lang: Lang } }) {
  return <LegalPage lang={params.lang} doc="communication" />;
}
