import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "../../globals.css";
import { getSite, setting, type Lang } from "@/lib/site/api";
import { copy, isLang } from "@/lib/site/copy";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Consent } from "@/components/site/Consent";
import { WhatsAppFab } from "@/components/site/WhatsAppFab";

export const revalidate = 60;
export function generateStaticParams() {
  return [{ lang: "ar" }, { lang: "en" }];
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://goldencare.example";

export async function generateMetadata({ params }: { params: { lang: string } }): Promise<Metadata> {
  const lang = (isLang(params.lang) ? params.lang : "ar") as Lang;
  const c = copy(lang);
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${c.brand} — ${c.promise}`, template: `%s · ${c.brand}` },
    description: c.heroText,
    icons: { icon: "/brand/emblem.png" },
    alternates: { canonical: `/${lang}`, languages: { ar: "/ar", en: "/en", "x-default": "/ar" } },
    openGraph: { siteName: c.brand, locale: lang === "ar" ? "ar_EG" : "en_US", type: "website", images: ["/brand/logo.png"] },
  };
}

export const viewport: Viewport = { themeColor: "#FBF7EF", width: "device-width", initialScale: 1 };

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: { lang: string } }) {
  if (!isLang(params.lang)) notFound();
  const lang = params.lang as Lang;
  const c = copy(lang);
  const site = await getSite().catch(() => ({}));
  const s = (k: string) => setting(site, k, lang);
  const whatsapp = s("whatsapp")?.replace(/\D/g, "") || null;
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body className="min-h-screen bg-ivory-50 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2">{lang === "ar" ? "تخطَّ إلى المحتوى" : "Skip to content"}</a>
        <SiteHeader lang={lang} whatsapp={whatsapp} />
        <main id="main">{children}</main>
        <SiteFooter lang={lang} address={s("address")} mobile={s("mobile")} whatsapp={whatsapp} hours={s("hours")} mapUrl={s("map_url")} />
        {whatsapp && <WhatsAppFab number={whatsapp} label={c.whatsapp} />}
        <Consent ids={{ ga4: s("analytics.ga4"), meta: s("analytics.meta_pixel"), tiktok: s("analytics.tiktok_pixel"), ads: s("analytics.google_ads") }}
          text={c.cookiesText} accept={c.accept} reject={c.reject} />
      </body>
    </html>
  );
}
