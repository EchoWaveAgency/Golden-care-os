import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/session";
import { navFor } from "@/lib/nav";
import { signOut, setLocale } from "@/app/actions/auth";
import type { DictKey } from "@/lib/i18n";
import { NavLinks, BackField, type NavGroup } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  // Accounts created by an administrator must set their own password first.
  if (ctx.profile?.must_change_password) redirect("/os/password");
  // Two-factor sign-in (enforced by the database: no permissions until it is done).
  if (ctx.needsMfa) redirect("/os/mfa");
  const { t, locale } = ctx;
  const items = navFor(ctx.perms);
  const sections = Array.from(new Set(items.map((i) => i.section)));
  const name = (locale === "en" ? ctx.profile?.full_name_en : null) ?? ctx.profile?.full_name_ar ?? ctx.user.email;

  const groups: NavGroup[] = sections.map((sec) => ({
    section: t(sec as DictKey),
    items: items.filter((i) => i.section === sec).map((i) => ({ href: i.href, label: t(i.label) })),
  }));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-navy-700 px-3 py-6 lg:flex">
        <Link href="/os" className="mb-8 flex items-center gap-3 px-3">
          <Image src="/brand/emblem.png" alt="" width={48} height={30} />
          <div>
            <p className="font-semibold text-gold-300">{t("app.name")}</p>
            <p className="text-[11px] text-ivory-300/80">{t("app.system")}</p>
          </div>
        </Link>
        <nav className="flex-1 overflow-y-auto"><NavLinks groups={groups} /></nav>
        <div className="border-t border-white/10 px-3 pt-4 text-sm">
          <Link href="/os/me" className="block truncate text-ivory-100 hover:text-gold-300" data-my-file>{name}</Link>
          <div className="mt-3 flex items-center justify-between">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
              <BackField />
              <button className="text-xs text-gold-300 hover:underline">{t("common.switchLang")}</button>
            </form>
            <form action={signOut}><button className="text-xs text-ivory-300 hover:text-white">{t("auth.logout")}</button></form>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 bg-navy-700 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/os" className="flex items-center gap-2">
              <Image src="/brand/emblem.png" alt="" width={36} height={23} />
              <span className="font-semibold text-gold-300">{t("app.name")}</span>
            </Link>
            <div className="flex items-center gap-4 text-xs">
              <Link href="/os/me" className="text-ivory-100">{locale === "ar" ? "بياناتي" : "My file"}</Link>
              <form action={setLocale}>
                <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
                <BackField />
                <button className="text-gold-300">{t("common.switchLang")}</button>
              </form>
              <form action={signOut}><button className="text-ivory-300">{t("auth.logout")}</button></form>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-3"><NavLinks groups={groups} compact /></nav>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
