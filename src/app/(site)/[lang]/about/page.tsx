import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { getSite, getSpecialties, pick, setting, type Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { PageHero } from "@/components/site/PageHero";
import { Feathers } from "@/components/site/Feathers";

export const revalidate = 60;
export async function generateMetadata({ params }: { params: { lang: Lang } }): Promise<Metadata> {
  return { title: copy(params.lang).about, alternates: { canonical: `/${params.lang}/about`, languages: { ar: "/ar/about", en: "/en/about" } } };
}
export default async function About({ params }: { params: { lang: Lang } }) {
  const lang = params.lang; const c = copy(lang); const ar = lang === "ar";
  const [site, specialties] = await Promise.all([getSite().catch(() => ({})), getSpecialties().catch(() => [])]);
  const standards = ar
    ? [["دقة المواعيد", "جداول واضحة لكل طبيب، وتأكيد وتذكير لكل موعد، لتقليل الانتظار."], ["ملف طبي موحد", "سجل واحد لكل مريض يربط الزيارات والتشخيص والمتابعة بين العيادات."], ["خصوصية وأمان", "كل اطلاع على بيانات المريض يتم بصلاحيات محددة ويُسجَّل."], ["متابعة بعد الزيارة", "فريق خدمة المرضى يتابع معك التعليمات والمواعيد القادمة."]]
    : [["Accurate appointments", "Clear schedules per doctor, confirmation and reminders for every appointment, to reduce waiting."], ["One medical file", "A single record per patient linking visits, diagnoses and follow-up across clinics."], ["Privacy and security", "Every access to patient data is permission-based and logged."], ["Follow-up after the visit", "Our patient experience team follows up on instructions and upcoming appointments."]];
  return (
    <>
      <PageHero title={c.about} subtitle={ar ? "عيادات جولدن كير مركز طبي متعدد التخصصات في مدينة الشروق، يجمع الرعاية الطبية والتجميلية في مكان واحد." : "Golden Care Clinics is a multi-specialty medical center in El Shorouk City bringing medical and aesthetic care together in one place."} />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold text-navy-700">{c.promise}</h2>
          <Feathers className="mt-3 w-24" />
          <p className="mt-5 leading-8 text-ink-500">{ar ? "رمزنا مستوحى من الصقر المصري بجناحين مفتوحين: حماية ورعاية تمتد لكل مريض ولأسرته." : "Our emblem is inspired by the Egyptian falcon with open wings: protection and care that extend to every patient and their family."}</p>
          {setting(site, "address", lang) && <p className="mt-4 text-sm text-teal-700">{setting(site, "address", lang)}</p>}
        </div>
        <Image src="/brand/logo.png" alt={c.brand} width={420} height={420} className="mx-auto rounded-3xl shadow-card" />
      </div>
      <section className="bg-white py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="mb-8 text-2xl font-semibold text-navy-700">{ar ? "معاييرنا" : "Our standards"}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {standards.map(([h, p]) => (
              <div key={h} className="rounded-2xl border border-ivory-300/70 p-6">
                <h3 className="font-semibold text-teal-700">{h}</h3>
                <p className="mt-2 text-sm leading-7 text-ink-500">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {specialties.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="mb-6 text-2xl font-semibold text-navy-700">{c.ourSpecialties}</h2>
          <div className="flex flex-wrap gap-2">
            {specialties.map((s) => <Link key={s.slug} href={`/${lang}/specialties/${s.slug}`} className="rounded-full border border-ivory-300 bg-white px-4 py-2 text-sm text-navy-700 hover:border-teal-700">{pick(s, "title", lang)}</Link>)}
          </div>
        </section>
      )}
    </>
  );
}
