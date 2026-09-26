# Website security model

- **Separate contexts**: public (anon), staff (RLS), patient (next milestone). `anon` has no table grants; it can execute only the nine `public_*` / `submit_web_inquiry` functions. Tested in `supabase/tests/06_website_crm.sql`.
- **Default privileges**: new functions are not executable by PUBLIC (migration 0010), so new database code is private until explicitly granted.
- **Forms**: honeypot field, minimum fill time, server-side validation, database validation, per-phone throttle, consent required, message length limits. No internal IDs are returned — only a lead reference.
- **Availability** re-checked at submission time; the website cannot request a time that is not free.
- **No medical data** is collected by public forms.
- **Consent logging**: consent flags and consent text version stored on each lead.
- **Analytics** gated by consent; no identifiers sent.
- **Robots**: `/os`, `/api`, and portal paths disallowed; staff pages are `noindex`.
- **Still required**: CAPTCHA/Turnstile or edge rate limiting per IP (behind a CDN), CSP header, upload scanning (when uploads are added), portal-specific controls (OTP abuse protection, signed document URLs).
