# SEO — implemented

- Static generation + 60 s revalidation for public pages; clean bilingual URLs `/ar/...` and `/en/...`.
- `lang`/`dir` per language; `alternates.languages` (hreflang) and canonical on every public page.
- `sitemap.xml` (all public pages × both languages with alternates) and `robots.txt`.
- JSON-LD: `MedicalClinic` (home), `Physician` (doctor pages), `FAQPage` (specialty FAQs).
- Titles/descriptions from approved content.
- Set `NEXT_PUBLIC_SITE_URL` in production for absolute URLs.

Pending: article pages with author/medical-reviewer and review dates, redirect manager, Core Web Vitals monitoring, Google Business Profile linkage.
