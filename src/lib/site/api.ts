import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

// Anonymous, cookie-less client: the website sees exactly what an anonymous visitor may see.
export function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Lang = "ar" | "en";
export type Bi = { ar: string | null; en: string | null };
export type Faq = { q_ar: string; a_ar: string; q_en: string; a_en: string };

export type SpecialtyCard = { slug: string; code: string; title_ar: string; title_en: string; summary_ar: string | null; summary_en: string | null };
export type Doctor = {
  id: string; slug: string; name_ar: string; name_en: string; title_ar: string | null; title_en: string | null;
  bio_ar: string | null; bio_en: string | null; qualifications_ar: string | null; qualifications_en: string | null;
  photo_url: string | null; languages: string[]; accepts_online_booking: boolean;
  specialty: { code: string; name_ar: string; name_en: string; slug: string | null };
};
export type Offer = {
  slug: string; title_ar: string; title_en: string; summary_ar: string | null; summary_en: string | null;
  terms_ar: string; terms_en: string; disclaimer_ar: string | null; disclaimer_en: string | null;
  price: number; regular_price: number | null; starts_at: string; ends_at: string; capacity: number | null; specialty_id: string | null;
};
export type Specialty = SpecialtyCard & {
  body_ar: string | null; body_en: string | null; preparation_ar: string | null; preparation_en: string | null; faq: Faq[];
  doctors: Doctor[]; offers: Offer[];
  services: { code: string; name_ar: string; name_en: string; price: number | null; online_bookable: boolean }[];
};
export type Landing = {
  slug: string; campaign_name: string; title_ar: string; title_en: string; hero_ar: string | null; hero_en: string | null;
  body_ar: string | null; body_en: string | null; benefits: { ar: string; en: string }[]; faq: Faq[];
  cta_variant: "book" | "callback" | "whatsapp"; show_countdown: boolean; starts_at: string; ends_at: string | null;
  offer: Offer | null; doctors: Doctor[]; specialty_slug: string | null;
  variants?: { code: string; weight?: number; title_ar: string; title_en?: string; hero_ar?: string | null; hero_en?: string | null }[];
};

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await anonClient().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const TTL = { revalidate: 60, tags: ["site"] };
export const getSite = unstable_cache(() => rpc<Record<string, Bi>>("public_site"), ["public_site"], TTL);
export const getSpecialties = unstable_cache(() => rpc<SpecialtyCard[]>("public_specialties"), ["public_specialties"], TTL);
export const getSpecialty = unstable_cache((slug: string) => rpc<Specialty | null>("public_specialty", { p_slug: slug }), ["public_specialty"], TTL);
export const getDoctors = unstable_cache((slug?: string) => rpc<Doctor[]>("public_doctors", { p_specialty_slug: slug ?? null }), ["public_doctors"], TTL);
export const getDoctor = unstable_cache((slug: string) => rpc<Doctor | null>("public_doctor", { p_slug: slug }), ["public_doctor"], TTL);
export const getOffers = unstable_cache(() => rpc<Offer[]>("public_offers", { p_specialty_slug: null }), ["public_offers"], TTL);
export type ArticleCard = { slug: string; title_ar: string; title_en: string; summary_ar: string | null; summary_en: string | null; reading_minutes: number | null; published_at: string };
export type Article = ArticleCard & { kind: string; body_ar: string; body_en: string | null; sources: string | null; author: Doctor | null };
export type Testimonial = { name_ar: string; name_en: string; quote_ar: string; quote_en: string; rating: number | null };
export const getArticles = unstable_cache((kind: string = "article") => rpc<ArticleCard[]>("public_articles", { p_kind: kind, p_specialty_slug: null }), ["public_articles"], TTL);
export const getArticle = unstable_cache((slug: string) => rpc<Article | null>("public_article", { p_slug: slug }), ["public_article"], TTL);
export const getTestimonials = unstable_cache((specialty?: string) => rpc<Testimonial[]>("public_testimonials", { p_specialty_slug: specialty ?? null, p_limit: 6 }), ["public_testimonials"], TTL);
export const getLanding = unstable_cache((slug: string) => rpc<Landing | null>("public_landing", { p_slug: slug }), ["public_landing"], TTL);

/** Availability is never cached: it must reflect bookings made seconds ago. */
export async function getSlots(doctorId: string, from: string, days = 7) {
  return rpc<{ slot_start: string; slot_end: string }[]>("public_available_slots", { p_doctor: doctorId, p_from: from, p_days: days });
}

export function pick<T extends Record<string, unknown>>(o: T | null | undefined, base: string, lang: Lang): string {
  if (!o) return "";
  const v = o[`${base}_${lang}`] ?? o[`${base}_ar`];
  return typeof v === "string" ? v : "";
}
export function setting(site: Record<string, Bi>, key: string, lang: Lang): string | null {
  const v = site[key];
  return (v?.[lang] ?? v?.ar ?? null) || null;
}
