# Website sitemap (both `/ar` and `/en`)

| Path | Source of content |
|---|---|
| `/` | Published specialties, active offers, published doctor profiles, site settings |
| `/specialties`, `/specialties/[slug]` | `site_specialty_pages` (published snapshot) + public services/prices + doctors + offers |
| `/doctors`, `/doctors/[slug]` | `site_doctor_profiles` (published) |
| `/offers` | `offers` — approved, within dates, capacity left, service active |
| `/book` | Live availability; `?specialty=`, `?doctor=`, `?offer=` preselect |
| `/contact` | Site settings + callback form |
| `/about` | Static non-clinical copy + published specialties |
| `/lp/[slug]` | `landing_pages` — approved and within start/end dates, else 404 |
| `/privacy`, `/terms`, `/appointment-policy`, `/communication-consent` | Starter texts in `src/lib/site/legal.ts` — **legal review required** |
| `/portal` | Placeholder until the patient portal milestone (noindex) |
| `/os/*` | Staff system (disallowed in robots.txt) |

Not yet built from the spec: medical articles, patient instructions library, devices / Cynosure Elite+ page, testimonials (with consent), downloadable documents, redirect manager.
