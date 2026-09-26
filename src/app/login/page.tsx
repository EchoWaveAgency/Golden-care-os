import Image from "next/image";
import { getLocale } from "@/lib/session";
import { translator } from "@/lib/i18n";
import { setLocale } from "@/app/actions/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const locale = await getLocale();
  const t = translator(locale);
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden items-center justify-center overflow-hidden bg-navy-700 lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(184,135,47,.35),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(15,94,99,.6),transparent_50%)]" />
        <div className="relative max-w-md px-10 text-center text-ivory">
          <Image src="/brand/emblem.png" alt="" width={260} height={164} className="mx-auto" priority />
          <p className="mt-8 text-3xl font-semibold tracking-wide text-gold-300">{t("app.name")}</p>
          <p className="mt-2 text-sm uppercase tracking-[0.2em] text-ivory-300">{t("app.system")}</p>
          <p className="mt-10 text-lg text-ivory-200">{t("app.promise")}</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <Image src="/brand/emblem.png" alt="" width={140} height={88} className="mx-auto" priority />
            <p className="mt-3 text-xl font-semibold text-gold-700">{t("app.name")}</p>
          </div>
          <h1 className="text-2xl font-semibold text-navy-700">{t("auth.login")}</h1>
          <p className="mb-8 mt-1 text-sm text-ink-500">{t("app.system")}</p>
          <LoginForm labels={{ email: t("auth.email"), password: t("auth.password"), login: t("auth.login"), loading: t("common.loading") }} />
          <form action={setLocale} className="mt-8 text-center">
            <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
            <input type="hidden" name="back" value="/login" />
            <button className="text-sm text-teal-700 underline-offset-4 hover:underline">{t("common.switchLang")}</button>
          </form>
        </div>
      </section>
    </main>
  );
}
