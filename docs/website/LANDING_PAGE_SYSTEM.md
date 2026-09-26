# Landing-page system

Create in `/os/content?type=landing` — no code changes. Fields: slug, campaign name, specialty, linked offer, doctors, AR/EN title, hero, body, approved benefits, FAQ, CTA variant (book / callback / WhatsApp), start/end, countdown.

Guarantees enforced by the database:
- Visible only when approved, published, and inside its start/end window; otherwise the URL returns 404.
- A countdown is only allowed with a real end date (`countdown_needs_real_expiry` constraint).
- A linked offer shows only while the offer itself is active; its price and terms are frozen on the appointment when a lead is converted.
- Form submissions carry the landing page, offer, specialty and UTM parameters (`utm_source/medium/campaign/content/term`) into the lead.

Not yet built: A/B tests for CTA and form variants, per-page capacity rules beyond the offer's capacity, before-and-after media with documented consent.
