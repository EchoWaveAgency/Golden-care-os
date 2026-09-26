# Analytics event dictionary

Tracking tags load only after the visitor accepts in the consent banner, and only if IDs are set in `/os/settings?tab=site`.

| Event | When | GA4 | Meta | TikTok | Payload |
|---|---|---|---|---|---|
| `page_view` | each page (after consent) | automatic | `PageView` | `page` | none |
| `lead_submitted` | callback/inquiry form accepted | `lead_submitted` | `Lead` | `SubmitForm` | none |
| `booking_requested` | booking request accepted | `booking_requested` | `Lead` | `SubmitForm` | none |
| `whatsapp_click` | WhatsApp button | `whatsapp_click` | `Contact` | `Contact` | none |

No names, phone numbers, emails, specialties or appointment details are sent to any third party. A submitted form is **not** a completed patient conversion: confirmed appointments, arrivals and completed visits are counted only from Golden Care OS records (funnel statuses on `leads`, linked to appointments).
