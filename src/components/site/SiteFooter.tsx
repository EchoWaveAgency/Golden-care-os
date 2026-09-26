import Image from "next/image";
import Link from "next/link";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { Feathers } from "./Feathers";

export function SiteFooter({ lang, address, mobile, whatsapp, hours, mapUrl }: { lang: Lang; address: string | null; mobile: string | null; whatsapp: string | null; hours: string | null; mapUrl: string | null }) {
  const c = copy(lang);
  return (
    <footer className="mt-24 bg-navy-900 text-ivory-200">
      <Feathers className="rounded-none" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-3">
            <Image src="/brand/emblem.png" alt="" width={64} height={40} />
            <div>
              <p className="text-lg font-semibold text-gold-300">{c.brand}</p>
              <p className="text-sm text-ivory-300">{c.promise}</p>
            </div>
          </div>
          <p className="mt-5 max-w-md text-sm leading-7 text-ivory-300">{c.tagline}</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium text-white">{c.visitUs}</p>
          {address && <p className="leading-7 text-ivory-300">{address}</p>}
          {hours && <p className="text-ivory-300">{hours}</p>}
          {mapUrl && <a href={mapUrl} target="_blank" rel="noopener" className="text-gold-300 hover:underline">{c.openMap}</a>}
          {mobile && <p><a href={`tel:${mobile}`} className="num text-ivory-100 hover:underline">{mobile}</a></p>}
          {whatsapp && <p><a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener" className="text-gold-300 hover:underline">{c.whatsapp}</a></p>}
        </div>
        <div className="space-y-2 text-sm">
          <Link href={`/${lang}/privacy`} className="block text-ivory-300 hover:text-white">{c.privacy}</Link>
          <Link href={`/${lang}/terms`} className="block text-ivory-300 hover:text-white">{c.termsOfUse}</Link>
          <Link href={`/${lang}/appointment-policy`} className="block text-ivory-300 hover:text-white">{c.apptPolicy}</Link>
          <Link href={`/${lang}/communication-consent`} className="block text-ivory-300 hover:text-white">{c.commsPolicy}</Link>
          <Link href={`/${lang}/portal`} className="block text-ivory-300 hover:text-white">{c.portal}</Link>
          <Link href="/os/login" className="block text-ivory-300/60 hover:text-white">{c.staff}</Link>
        </div>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-xs text-ivory-300/70">© {new Date().getFullYear()} {c.brand} — {c.rights}</p>
    </footer>
  );
}
