# Golden Friday — Lead Flow × Call Center / تدفق العملاء × الكول سنتر

**AD → WHATSAPP → LEAD CAPTURE → LEAD LOG → CALL CENTER → FOLLOW-UP → BOOKING → REPORT**
Every lead has a source. Every lead has an owner. Every lead has a status. — لكل عميل: مصدر · مسؤول · حالة.

## Why messages were "not arriving" / لماذا كانت الرسائل "لا تصل"
Before this change the WhatsApp webhook stored every message, but only some became call-center leads:
- a message from an existing patient became a *support ticket* (not visible in the leads inbox);
- from the 4th message in 24 h, a number's messages created nothing;
- voice notes and images from unknown numbers went to the care-escalation queue;
- the ad that brought the customer (Click-to-WhatsApp `referral`) and the WhatsApp name were never saved.

قبل التعديل: رسائل المرضى الحاليين كانت تتحول لـ"تذكرة" وليس لعميل، والرسالة الرابعة من نفس الرقم في اليوم كانت تُهمل، والرسائل الصوتية كانت تذهب لقائمة أخرى، ولم يكن يُحفظ أي إعلان جاء منه العميل.

Now every message from an ad, with a campaign code, or from a number with an open lead is written to the lead **before** anything else runs, and shows in the call center within 15 seconds.

## Screens / الشاشات
| Screen | Who | Path |
|---|---|---|
| Call center queue (urgent first, one-tap actions, timers) — مركز الاتصال | Agents, supervisors | `/os/calls` |
| Lead workspace (actions, follow-up, booking, WhatsApp reply, notes, full history, assign / archive) | Owner agent, supervisors | `/os/calls/<id>` |
| Golden Friday control (status counts, KPIs, alerts, campaign / agent / daily / ad reports, CSV) — لوحة التحكم | Admin, marketing | `/os/golden` |
| Campaign codes, SLA, auto-assign, agents on duty, WhatsApp checklist — الحملات والإعدادات | Admin | `/os/golden/settings` |

## Roles / الصلاحيات
- **Call Center Agent** (`call_center_agent`, new): own leads only — status, notes, follow-up, booking, WhatsApp reply. No delete, no campaign settings, no reports.
- **Admin** (center director, operations manager): all leads, assign / reassign / unassign, archive, campaigns, settings, reports, export.
- **Marketing**: all leads (read), campaign / source / agent reports. No export, no assignment, no user rights.
Give agents the role in **Users & permissions**. Agents switch themselves **on duty**; only agents on duty receive new leads (round-robin, fewest untouched leads first).

## What you must configure in Meta / المطلوب منك في Meta
1. **WhatsApp Cloud API app** (developers.facebook.com → your app → WhatsApp):
   - *Configuration → Webhook*: Callback URL `https://<your-domain>/api/webhooks/whatsapp`, Verify token = the value of `WHATSAPP_VERIFY_TOKEN`. Subscribe the **messages** field.
   - *App settings → Basic → App secret* → `WHATSAPP_APP_SECRET` (every webhook call is signature-checked; without it the webhook answers 503 and Meta retries).
   - *Phone number ID* → `WHATSAPP_PHONE_NUMBER_ID`; a **permanent System User token** with `whatsapp_business_messaging` (+ `whatsapp_business_management`) → `WHATSAPP_TOKEN`.
   - The number in the ads must be **this** Cloud API number. If the call center also uses the WhatsApp Business app on the same number, only messages that reach the Cloud API webhook are recorded — confirm the setup (see OPEN_QUESTIONS 126).
2. **Ads (Ads Manager)**: objective *Engagement/Leads → Messaging apps → WhatsApp* (Click-to-WhatsApp). In each ad's **pre-filled message** put the campaign code, e.g. `GF26-LASER — أريد تفاصيل عرض الليزر`. Meta also sends the ad id with the first message; the code makes attribution certain even if the customer edits the text (keywords and ad ids are fall-backs).
   Name Meta campaigns with the code too (`GF26-LASER | Golden Friday`) so ad-name enrichment can attribute leads that arrive without the code.
3. **Optional — ad names**: a System User token with `ads_read` on the clinic's ad account → `META_ADS_TOKEN`. The scheduled job then fills ad / ad set / campaign names.

## Environment variables / متغيرات البيئة
| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | database (existing) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | server-only; webhook stores messages (never in the browser) |
| `WHATSAPP_VERIFY_TOKEN` | yes | webhook registration |
| `WHATSAPP_APP_SECRET` | yes | webhook signature check |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | yes for replies | auto-acknowledgement + replies from the lead page |
| `CRON_SECRET` | yes | `POST /api/jobs/dispatch` every 1–5 min (safety sweep, ad names, reminders) |
| `META_ADS_TOKEN` | optional | ad / ad set / campaign names |
| `MESSAGING_MODE` | `whatsapp` in production (`dev` only logs) | |

## Deploy / التشغيل
1. Apply migration `supabase/migrations/20261120003400_lead_flow_call_center.sql` to **staging** first (`supabase db push`), then production. It is additive: existing leads get ids (`LD-…`), sources and statuses.
2. Deploy the app (Vercel) with the variables above; schedule the dispatcher job.
3. In `/os/golden/settings`: check the integration list is all ✓, review campaign codes, SLA (5 min) and auto-assign.
4. Give agents the *Call Center Agent* role; they sign in → land on `/os/calls` → switch **On duty**.
5. Send a test WhatsApp message containing `GF26-LASER` from a personal phone to the clinic number → it must appear in an agent's queue with a `GF26-XXXXXX` id. "Last WhatsApp message received" on the settings page confirms the webhook is live.

## Definitions used in reports / تعريفات التقارير
- **Received** = time of the customer's first message (Meta timestamp), Cairo dates.
- **First contact** = first call-center action (contacted, interested, no response, follow-up, booked, WhatsApp reply…). **Response time** = first contact − received.
- **SLA compliance** = contacted within the target ÷ (contacted + still waiting past the target).
- **Contact / interest / booking / no-response rate** = leads that reached that state ÷ all leads of the period. Archived leads are excluded (export includes them, flagged).
