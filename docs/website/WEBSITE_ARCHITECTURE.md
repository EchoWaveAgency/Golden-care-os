# Website architecture

One Next.js application, three authorization contexts, one database.

| Context | Paths | Auth | Data access |
|---|---|---|---|
| Public website | `/ar/*`, `/en/*`, `/sitemap.xml`, `/robots.txt`, `/api/public/slots` | none | Anonymous, cookie-less Supabase client calling `public_*` SECURITY DEFINER functions only. No table grants to `anon`. |
| Staff system | `/os/*` | Supabase session (middleware) | RLS as the signed-in staff member |
| Patient portal | `/ar/portal` (placeholder) | next milestone: separate patient context | — |

## Data flow
- **Read**: pages call `getSpecialties / getSpecialty / getDoctors / getOffers / getLanding / getSite` (`src/lib/site/api.ts`). Results are cached 60 s with the `site` tag; publishing content or saving contact details calls `revalidateTag("site")`, so changes appear immediately.
- **Availability**: `/api/public/slots` → `public_available_slots()` (never cached). Only doctors with a live profile that accepts online booking; 2-hour lead time; excludes existing appointments, room conflicts, leave/holidays.
- **Write**: forms post to the `submitInquiry` server action → `submit_web_inquiry()` → a lead in the Patient Relations inbox. The function validates phone, consent, name, message length, re-checks that a requested time is still free, throttles 5 submissions per phone per 24 h, and merges repeat submissions into the open lead.
- **Conversion**: staff convert a lead in `/os/leads/[id]` → patient matched or created → appointment on a real slot → `lead_link_appointment()` freezes offer price/terms and consumes offer capacity. The funnel then follows the appointment automatically (confirmed → arrived → visit completed).

## Rendering
Static generation with 60-second revalidation for public pages; booking page and API are dynamic; staff pages are always dynamic. Fonts self-hosted.
