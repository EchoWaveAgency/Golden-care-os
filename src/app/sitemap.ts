import type { MetadataRoute } from "next";
import { getDoctors, getSpecialties } from "@/lib/site/api";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://goldencare.example";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [specialties, doctors] = await Promise.all([getSpecialties().catch(() => []), getDoctors().catch(() => [])]);
  const paths = ["", "/specialties", "/doctors", "/offers", "/book", "/about", "/contact", "/privacy", "/terms", "/appointment-policy", "/communication-consent",
    ...specialties.map((s) => `/specialties/${s.slug}`), ...doctors.map((d) => `/doctors/${d.slug}`)];
  return paths.flatMap((p) => (["ar", "en"] as const).map((l) => ({
    url: `${SITE_URL}/${l}${p}`,
    alternates: { languages: { ar: `${SITE_URL}/ar${p}`, en: `${SITE_URL}/en${p}` } },
    changeFrequency: "weekly" as const,
    priority: p === "" ? 1 : 0.7,
  })));
}
