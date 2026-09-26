import type { Lang } from "@/lib/site/api";

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://goldencare.example";

export function clinicJsonLd(lang: Lang, address: string | null, phone: string | null, specialties: string[]) {
  return {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    name: lang === "ar" ? "عيادات جولدن كير" : "Golden Care Clinics",
    url: `${SITE_URL}/${lang}`,
    logo: `${SITE_URL}/brand/logo.png`,
    ...(address ? { address: { "@type": "PostalAddress", streetAddress: address, addressLocality: lang === "ar" ? "مدينة الشروق" : "El Shorouk City", addressCountry: "EG" } } : {}),
    ...(phone ? { telephone: phone } : {}),
    medicalSpecialty: specialties,
  };
}

export function physicianJsonLd(lang: Lang, name: string, specialty: string, slug: string) {
  return { "@context": "https://schema.org", "@type": "Physician", name, medicalSpecialty: specialty, url: `${SITE_URL}/${lang}/doctors/${slug}` };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })) };
}
