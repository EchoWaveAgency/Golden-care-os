# CMS content model & workflow

Content types (tables): `site_specialty_pages`, `site_doctor_profiles`, `offers`, `landing_pages`, plus `site_settings` (contact details and tracking IDs).

Every content table carries: `status`, `requires_medical`, `published_data` (snapshot shown on the site), `published_at`, `publish_at` (scheduling), medical and marketing approver/time, `review_note`, `version`, editor, timestamps. Every insert, edit and transition is written to `content_revisions` (full payload) and `audit_events`.

## Workflow
Draft → Medical Review → Marketing Review → Approved → (Scheduled) → Published → Archived

| Step | Permission | Rule |
|---|---|---|
| Draft → Medical Review | `content.edit` | Medical content cannot skip medical review |
| Medical Review → Marketing Review | `content.medical_approve` | The last editor cannot medically approve their own edit |
| Send back to Draft | reviewer permission | A note is required |
| Marketing Review → Approved | `content.marketing_approve` | |
| Approved → Published | `content.publish` | Copies content into `published_data`; future `publish_at` ⇒ Scheduled |
| Published → Archived | `content.publish` | Leaves the site immediately |

Editing reviewed content sends it back to Draft and clears approvals, **while the last published version stays live** until the new version is published. Status can only change through `content_transition()` (direct updates are rejected). Expired offers and landing pages disappear automatically; the content list flags expired items and overdue medical reviews.

## Roles
`marketing` (edit, marketing approval, publish), `medical_director` (edit, medical approval), `center_director` (publish). Seeded in migration 0010.
