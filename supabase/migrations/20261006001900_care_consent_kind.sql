-- Golden Care OS — 0019 Consent kind for the patient care assistant (own file: a new enum value
-- must be committed before other statements can use it).
alter type public.consent_kind add value if not exists 'care_followup';
