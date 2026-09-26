import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";
import { getLocale } from "@/lib/session";
import { dirOf } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { default: "Golden Care OS", template: "%s · Golden Care OS" },
  description: "Golden Care Healthcare Operating System",
  icons: { icon: "/brand/emblem.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0F5E63", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
