import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { PortalLogin } from "./PortalLogin";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PortalSignIn({ params, searchParams }: { params: { lang: Lang }; searchParams: { account?: string } }) {
  const lang = params.lang;
  const ar = lang === "ar";
  const c = copy(lang);
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: me } = await supabase.rpc("portal_me");
    if (me) redirect(`/${lang}/portal/home`);
  }
  return (
    <>
      <PageHero title={c.portal} subtitle={ar ? "مواعيدك وروشتاتك وفواتيرك في مكان واحد — بدون كلمة مرور." : "Your appointments, prescriptions and invoices in one place — no password needed."} />
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 md:grid-cols-5">
        <section className="rounded-2xl border border-ivory-300/70 bg-white p-6 shadow-card md:col-span-3">
          <h2 className="mb-4 text-lg font-semibold text-navy-700">{ar ? "تسجيل الدخول" : "Sign in"}</h2>
          {searchParams.account === "none" && (
            <p className="mb-4 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn">{ar ? "هذا الحساب ليس حساب مريض. سجّل الدخول برقم موبايلك." : "This is not a patient account. Sign in with your mobile number."}</p>
          )}
          <PortalLogin lang={lang} />
        </section>
        <aside className="space-y-4 text-sm leading-7 text-ink-500 md:col-span-2">
          <p>{ar ? "يمكنك الدخول إذا كان لك ملف في عيادات جولدن كير. أول مرة؟ احجز زيارتك وسيُفتح لك ملف." : "You can sign in if you have a file at Golden Care Clinics. First time? Book a visit and we will open your file."}</p>
          <p>{ar ? "لا نطلب كلمة مرور. نرسل رمزًا لمرة واحدة إلى واتساب الرقم المسجل. لا تشارك الرمز مع أي شخص، ولن يطلبه منك موظفونا." : "No password: we send a one-time code to the registered WhatsApp number. Never share the code — our staff will never ask for it."}</p>
          <p>{ar ? "ملخصات الزيارات والروشتات تظهر بعد أن يراجعها طبيبك ويفرج عنها." : "Visit summaries and prescriptions appear after your doctor reviews and releases them."}</p>
          <Link href={`/${lang}/book`} className="inline-block text-teal-700 hover:underline">{c.book} {ar ? "←" : "→"}</Link>
        </aside>
      </div>
    </>
  );
}
