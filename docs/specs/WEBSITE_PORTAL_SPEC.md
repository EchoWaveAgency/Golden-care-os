# Website, Landing Pages & Patient Portal — specification

Source: master prompt v3, section 20 (approved scope). Implementation notes in 20.16 are binding.

## 20. Golden Care Medical Website, Campaign Landing Pages, and Patient Portal

Build a complete bilingual medical website directly connected to Golden Care OS.

The solution must contain three integrated products:

1. Golden Care Clinics public medical website.
2. Campaign and offer landing-page platform.
3. Secure patient portal and personal medical account.

All three products must use the same central database and authorized APIs. Do not create duplicate patient, appointment, service, price, offer, or payment records.

The website must look like a specialized, trusted medical center, not a generic clinic template or an advertising-only website.

---

### 20.1 Public Medical Website

Create a fast, modern, responsive website for:

**Golden Care Clinics  
Madinat El Shorouk  
Town Center Mall  
Third Floor**

The address and contact details must remain configurable from the administration system.

The center currently communicates through mobile and WhatsApp. Do not display or assume a landline unless administrators add one later.

The website must support:

- Arabic as the primary language with correct RTL.
- English with correct LTR.
- Desktop, tablet, iPad, and mobile.
- Progressive Web App readiness.
- Accessible interface and readable typography.
- Medical teal, ivory, white, and restrained gold accents.
- Golden Care logo and approved identity.
- CMS-controlled content without requiring code changes.
- Fast page loading and optimized images.
- Search-engine optimization.
- Secure forms and spam protection.
- Cookie and privacy preferences.
- Medical-content review and approval workflow.

Required public pages:

- Home.
- About Golden Care.
- The medical family and founders.
- Our medical standards.
- Specialties.
- Individual specialty pages.
- Doctors.
- Individual doctor profiles.
- Services and procedures.
- Devices and medical technology.
- Cynosure Elite+ information page.
- Packages and approved offers.
- Book an appointment.
- Request a callback.
- Contact and location.
- Frequently asked questions.
- Medical articles.
- Patient instructions.
- Privacy policy.
- Terms of use.
- Cancellation and appointment policy.
- Communication-consent policy.
- Patient portal login.
- Campaign landing pages.

Required specialties:

- Dermatology and skin diseases.
- Laser and aesthetics.
- Dentistry and dental implants.
- Fixed and removable prosthodontics.
- Obstetrics and gynecology.
- Orthopedics.
- General surgery.
- Plastic surgery.
- Vascular surgery.
- Neurosurgery.
- Internal medicine.
- Clinical nutrition.

Each specialty page must support:

- Overview.
- Available services.
- Doctors.
- common patient questions;
- preparation instructions;
- related devices;
- approved offers;
- appointment availability;
- educational content;
- online booking or booking request;
- WhatsApp contact;
- medical disclaimer;
- structured SEO data.

Do not publish medical claims, prices, offers, doctors, schedules, or device information unless the content has an active approved record in Golden Care OS.

---

### 20.2 Website Content Management

Create an administration workspace for authorized marketing and medical users.

Content types must include:

- Website pages.
- specialty pages;
- doctor profiles;
- services;
- devices;
- medical articles;
- frequently asked questions;
- patient instructions;
- banners;
- offers;
- packages;
- landing pages;
- testimonials with explicit consent;
- downloadable documents;
- SEO titles and descriptions;
- redirects;
- navigation menus;
- contact details;
- branch details.

Required content workflow:

Draft → Medical Review → Marketing Review → Approved → Scheduled → Published → Archived.

Medical content must require approval from an authorized doctor or Medical Director before publication.

Maintain:

- Version history.
- author;
- reviewer;
- approval;
- publish and expiry dates;
- change comparison;
- rollback;
- audit history.

Do not allow expired offers or outdated medical instructions to remain active without an alert.

---

### 20.3 Landing-Page and Campaign System

Build a reusable landing-page engine inside the administration system.

Marketing users must be able to create landing pages without changing code.

Landing-page components should include:

- Campaign hero.
- service introduction;
- approved benefits;
- doctor or medical-team section;
- device section;
- offer details;
- before-and-after media only with documented patient consent;
- frequently asked questions;
- booking form;
- WhatsApp action;
- callback request;
- location and map;
- terms and conditions;
- medical disclaimer;
- countdown only when a real expiry date exists;
- campaign tracking fields.

Each landing page must support:

- Unique URL.
- Arabic and English versions.
- campaign name;
- service and specialty;
- active start and end dates;
- target branch;
- target doctors;
- approved price or package;
- eligibility rules;
- appointment capacity;
- campaign source;
- UTM parameters;
- Meta Pixel;
- Google Analytics;
- Google Ads tracking;
- TikTok Pixel when configured;
- conversion events;
- lead source;
- call-to-action tests;
- form variation tests;
- thank-you page;
- remarketing consent;
- automatic campaign expiry.

Do not use fake scarcity, fabricated countdowns, guaranteed medical results, misleading before-and-after images, or unapproved claims.

---

### 20.4 Lead and Booking Integration

Every website or landing-page action must enter Golden Care OS automatically.

When a visitor submits a form:

1. Validate the phone number and consent.
2. Search for an existing lead or patient.
3. Prevent unnecessary duplicate records.
4. Create or update the lead.
5. Record the campaign, page, channel, and UTM source.
6. Record the requested specialty, service, doctor, and preferred time.
7. Assign the case to Patient Experience and Relations.
8. Create a follow-up task and SLA.
9. Notify the assigned employee.
10. Allow appointment creation from the same lead record.
11. Update the conversion status.
12. Show the result in marketing and operations reports.

Required funnel stages:

Website visit → Inquiry → Contacted → Qualified → Appointment requested → Appointment confirmed → Arrived → Visit completed → Follow-up completed.

Do not describe patients as sales opportunities in patient-facing screens.

---

### 20.5 Online Appointment Booking

The website must display only valid availability returned by Golden Care OS.

Support:

- Specialty selection.
- service selection;
- doctor selection;
- branch selection;
- available date and time;
- new or existing patient;
- family-member booking;
- appointment instructions;
- booking confirmation;
- rescheduling;
- cancellation according to policy;
- waiting list;
- reminder preferences;
- online deposit when required;
- WhatsApp confirmation;
- booking reference.

Prevent:

- Double booking.
- booking outside doctor schedules;
- booking unavailable rooms or devices;
- conflicting resources;
- expired offer booking;
- unsupported procedure booking;
- uncontrolled access to doctor or patient information.

---

### 20.6 Secure Patient Portal

Create a separate secure patient portal connected to Golden Care OS.

The patient portal must not use the same unrestricted interface or permissions as staff accounts.

Login options should support:

- Verified mobile number.
- One-time password.
- secure password when configured;
- session management;
- device and login history;
- additional identity verification for sensitive documents;
- guardian or authorized-family access;
- account recovery.

Patient portal sections:

#### My Dashboard

- Next appointment.
- required preparation;
- recent visit;
- new prescription;
- available laboratory or radiology result;
- outstanding balance;
- package balance;
- follow-up request;
- notifications.

#### My Profile

- Personal details.
- contact information;
- emergency contact;
- communication preferences;
- consent preferences;
- authorized family members.

#### My Medical File

Patients may view only records approved for patient release, including:

- Approved visit summaries.
- diagnoses authorized for display;
- prescriptions;
- approved medical reports;
- laboratory results;
- radiology results;
- allergies and alerts appropriate for patient display;
- treatment plans;
- follow-up instructions;
- uploaded patient documents;
- clinical photographs when approved and consented.

Never expose:

- Internal staff notes.
- draft diagnoses;
- quality-review comments;
- internal risk flags;
- employee discussions;
- raw audit logs;
- doctor-settlement information;
- internal financial classifications;
- records belonging to another person.

#### My Appointments

- Upcoming appointments.
- appointment history;
- request new appointment;
- reschedule;
- cancel according to policy;
- join waiting list;
- appointment instructions;
- status and booking reference.

#### Prescriptions and Results

- View approved prescriptions.
- download approved PDF;
- share through a secure controlled link;
- view released lab and radiology results;
- receive notification when results become available;
- contact the center for clarification.

The patient portal must not provide autonomous AI medical interpretation.

#### My Financial Account

- Invoices.
- receipts;
- payments;
- remaining balances;
- approved quotations;
- treatment-plan installments;
- patient wallet ledger;
- packages and remaining units;
- subscriptions;
- loyalty points;
- referral benefits;
- secure payment links;
- refund-request status.

#### Support and Patient Experience

- Send an inquiry.
- request a callback;
- open a support ticket;
- submit complaint;
- complete satisfaction survey;
- update communication preferences;
- request a Google review link when eligible.

---

### 20.7 Family Accounts

Connect the patient portal to the Golden Care family-file system.

Support:

- Parent and child relationships.
- spouse relationships;
- legal guardian;
- authorized caregiver;
- adult family-member invitation;
- access expiry;
- permission level by family member;
- revocation of access;
- dependent booking;
- separate medical privacy for every person.

An adult patient must not automatically expose medical information to another family member.

All family access must have explicit authorization and audit history.

---

### 20.8 Offers, Packages, and Sales Controls

Offers displayed on the website must come from approved Golden Care OS records.

Each offer needs:

- Offer name.
- service or package;
- approved price;
- regular price when legally and operationally valid;
- start date;
- expiry date;
- branch;
- eligible doctors;
- available capacity;
- eligibility requirements;
- exclusions;
- refund and cancellation policy;
- medical suitability disclaimer;
- internal approval;
- active status.

Automatically hide:

- Expired offers.
- suspended services;
- unavailable doctors;
- inactive devices;
- fully consumed campaign capacity;
- offers awaiting approval.

The system must preserve the price and terms that applied when the patient booked.

---

### 20.9 Website Analytics and Conversion Reporting

Create an integrated marketing dashboard showing:

- Website sessions.
- landing-page visits;
- traffic source;
- campaign and UTM;
- form submissions;
- WhatsApp actions;
- callback requests;
- booking requests;
- confirmed appointments;
- completed visits;
- campaign-attributed collections where policy permits;
- cost per inquiry;
- cost per confirmed appointment;
- cost per completed visit;
- conversion by specialty, service, page, and campaign;
- cancellation and no-show rate by source;
- response time;
- follow-up completion.

Protect patient privacy. Marketing reports should use aggregated data where individual identification is unnecessary.

Do not count a website click as a completed patient conversion.

---

### 20.10 SEO and Medical Search Requirements

Implement:

- Server-side rendering or static generation where appropriate.
- sitemap;
- robots controls;
- canonical URLs;
- Arabic and English language tags;
- structured data for medical organization, physician, service, article, FAQ, and location where valid;
- optimized titles and descriptions;
- clean URLs;
- redirect management;
- image optimization;
- Core Web Vitals monitoring;
- local-search readiness;
- article-author and medical-review information;
- publication and review dates.

Do not automatically publish AI-generated medical articles.

---

### 20.11 Website and Portal Security

Required controls:

- Separate public, patient, and employee authorization contexts.
- server-side permission checks;
- OTP abuse protection;
- rate limiting;
- bot and spam protection;
- CSRF and XSS protection;
- secure cookies;
- session expiration;
- encrypted sensitive data;
- secure document links with expiry;
- malware scanning for uploads;
- upload type and size limits;
- consent logging;
- audit history;
- export and download logging;
- protection against patient-ID enumeration;
- webhook verification;
- payment idempotency;
- privacy-safe analytics;
- backup and restore;
- security monitoring.

Never expose medical records through predictable URLs.

---

### 20.12 Website Architecture

Prefer:

- Next.js and TypeScript when compatible with the existing project.
- Shared Golden Care design system.
- API gateway or secure backend-for-frontend.
- Golden Care OS as the central source of truth.
- PostgreSQL for governed records.
- secure object storage for medical documents.
- background jobs for notifications and integration retries.
- headless content-management architecture or an internal CMS module.
- CDN for public assets only.
- separation between public files and protected patient files.
- staging environment before production.

Do not create a second disconnected services, prices, doctors, offers, or appointments database.

---

### 20.13 Required User Journeys

Implement and test:

1. Visitor reads a specialty page and requests an appointment.
2. Patient Relations receives the lead with campaign source.
3. Employee contacts the patient and confirms the appointment.
4. Appointment appears in the doctor and reception schedule.
5. Patient logs in and sees the confirmed appointment.
6. Patient completes the visit.
7. Approved prescription and instructions appear in the patient portal.
8. Invoice and receipt appear in the financial account.
9. Patient completes a satisfaction survey.
10. Management sees the operational and campaign result.

Additional journeys:

- Existing patient books a family member.
- Patient purchases a package.
- Patient pays an appointment deposit.
- Patient views a released lab result.
- Patient requests rescheduling.
- Patient submits a complaint.
- An offer expires automatically.
- A payment fails and retries safely.
- An unauthorized person attempts to access another patient’s file.

---

### 20.14 Website Deliverables

Add these deliverables to the repository:

- `WEBSITE_ARCHITECTURE.md`
- `WEBSITE_SITEMAP.md`
- `PATIENT_PORTAL_SPEC.md`
- `LANDING_PAGE_SYSTEM.md`
- `CMS_CONTENT_MODEL.md`
- `SEO_REQUIREMENTS.md`
- `ANALYTICS_EVENT_DICTIONARY.md`
- `WEBSITE_SECURITY_MODEL.md`
- `PATIENT_PORTAL_PERMISSION_MATRIX.md`
- `WEBSITE_UAT_SCENARIOS.md`
- Arabic and English content templates.
- Reusable landing-page templates.
- Website API documentation.
- Automated tests.
- Deployment and rollback instructions.

---

### 20.15 Definition of Done

The website is complete only when:

- Public pages use real approved CMS content.
- Doctors, services, schedules, prices, and offers synchronize with Golden Care OS.
- Website inquiries create traceable Patient Relations records.
- Booking prevents conflicts.
- Patient login is secure.
- Patient records obey release and family-access rules.
- Payments reconcile with invoices and accounting.
- Arabic RTL and English LTR work correctly.
- Mobile and desktop layouts pass review.
- SEO configuration is complete.
- Analytics events are verified.
- Accessibility checks pass.
- Performance targets pass.
- Security tests pass.
- Backups and restoration are tested.
- Staging user-acceptance tests pass.
- No patient information appears in public analytics, logs, URLs, or unauthorized screens.

### 20.16 Implementation Notes (binding)

These notes adapt section 20 to the actual Golden Care OS stack (Next.js 14 + Supabase) and to what is already built.

- **One database.** The website, landing pages, and portal read and write the same Supabase project as the staff system. Services, prices, doctors, schedules, offers, appointments, invoices, and payments are never copied into a second store. Public pages read only through views or RPCs that expose approved, published, non-expired records.
- **Three authorization contexts.**
  - *Public:* anonymous access only to published CMS content and approved catalog views. Forms go through server-side route handlers with rate limiting and bot protection, never direct table inserts from the browser.
  - *Patient:* a separate `patient_accounts` link between an Auth user and one patient record, plus explicit `family_access_grants` (grantee, patient, permission level, expiry, revoked_at). Patient RLS policies are separate from staff policies. A patient session never receives staff role grants.
  - *Staff:* the existing role and permission model.
- **Release gate.** Portal-visible clinical content comes only from records with an explicit `released_to_patient_at` and releaser, such as a visit summary, prescription, report, or result. Draft encounters, internal notes, alerts marked internal, audit data, and settlement data are never selectable by the patient role. Test this with RLS tests for every table.
- **Non-enumerable identifiers.** Portal URLs use UUIDs or opaque tokens. Document downloads use short-lived signed Storage URLs. Every view and download of a released document is audited.
- **OTP in Egypt.** Phone OTP needs an SMS or WhatsApp provider approved by Golden Care. Build it behind an adapter with per-number and per-IP throttling, OTP expiry, and lockout. Until a provider is contracted, use email magic link or password for the portal in staging only.
- **Booking.** Online availability is computed server-side from `doctor_schedules`, `schedule_exceptions`, existing appointments, rooms, and devices. The existing exclusion constraints stay the final guard against double booking. Online bookings enter as `requested` unless policy allows auto-confirmation.
- **Leads.** Add a `leads` table and inquiry pipeline linked to patients by normalized phone, reusing `app.normalize_phone` and duplicate detection. Record UTM, landing page, campaign, consent, and assignment. Include follow-up tasks with SLA.
- **Offers.** Add `offers` with approval state, dates, branch, eligible doctors, capacity, and terms. On booking, snapshot the offer price and terms onto the appointment and invoice line so later changes never alter what the patient agreed to.
- **CMS workflow.** Content moves Draft → Medical Review → Marketing Review → Approved → Scheduled → Published → Archived. Every version is kept. Medical approval is required for medical content types and is enforced in the database, not only in the UI.
- **Analytics and privacy.** Tracking pixels (Meta, Google, TikTok) load only after consent. Conversion events never contain names, phone numbers, national IDs, diagnoses, or appointment specialty in ways that identify a person. Server-side conversion APIs, if used, send hashed identifiers only with explicit consent.
- **Hosting.** The public site can be statically generated with revalidation from the CMS. Patient and staff areas are always dynamic and never cached by the CDN.
- **Phase placement.** Public website and CMS go in Phase 3 (with a minimal "specialties + doctors + booking request" slice allowed earlier). Portal, family access, and online payments come after the refund, credit note, and release-gate work is complete.
