-- Golden Care OS — 0032 Consent kind for publishing a patient's testimonial (own migration: a new enum value
-- cannot be used in the transaction that adds it).
alter type public.consent_kind add value if not exists 'testimonial';
