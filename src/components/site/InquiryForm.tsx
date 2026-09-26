"use client";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { submitInquiry } from "@/app/actions/site";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { trackConversion } from "./Consent";

type Props = {
  lang: Lang; kind: "booking" | "callback" | "inquiry"; specialtySlug?: string; doctorSlug?: string; offerSlug?: string;
  landingSlug?: string; preferredStart?: string; submitLabel?: string; showMessage?: boolean; compact?: boolean;
};

export function InquiryForm(p: Props) {
  const c = copy(p.lang);
  const [state, action] = useFormState(submitInquiry, undefined);
  const params = useSearchParams();
  const [started, setStarted] = useState(0);
  const tracked = useRef(false);
  useEffect(() => setStarted(Date.now()), []);
  useEffect(() => {
    if (state?.ok && !tracked.current) { tracked.current = true; trackConversion(p.kind === "booking" ? "booking_requested" : "lead_submitted"); }
  }, [state, p.kind]);

  if (state?.ok) {
    return (
      <div role="status" className="rounded-2xl border border-ok/20 bg-ok-50 p-6 text-center">
        <p className="text-lg font-semibold text-ok">{c.thanksTitle}</p>
        <p className="mt-2 text-sm text-ink-500">{c.thanksText}</p>
        <p className="num mt-3 text-2xl font-semibold tracking-wider text-navy-700">{state.ref}</p>
      </div>
    );
  }
  const utm = (k: string) => params?.get(k) ?? "";
  return (
    <form action={action} className="space-y-4" noValidate={false}>
      <input type="hidden" name="lang" value={p.lang} />
      <input type="hidden" name="kind" value={p.kind} />
      <input type="hidden" name="started_at" value={started} />
      {p.specialtySlug && <input type="hidden" name="specialty_slug" value={p.specialtySlug} />}
      {p.doctorSlug && <input type="hidden" name="doctor_slug" value={p.doctorSlug} />}
      {p.offerSlug && <input type="hidden" name="offer_slug" value={p.offerSlug} />}
      {p.landingSlug && <input type="hidden" name="landing_slug" value={p.landingSlug} />}
      {p.preferredStart && <input type="hidden" name="preferred_start" value={p.preferredStart} />}
      {["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((k) => <input key={k} type="hidden" name={k} value={utm(k)} />)}
      {/* Honeypot for bots — hidden from people and assistive tech */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>

      <div className={p.compact ? "grid gap-3" : "grid gap-4 sm:grid-cols-2"}>
        <Field label={c.fullName}><input name="full_name" required minLength={2} maxLength={120} autoComplete="name" className="input" /></Field>
        <Field label={c.phone}><input name="phone" required inputMode="tel" autoComplete="tel" dir="ltr" placeholder="01xxxxxxxxx" className="input" /></Field>
        {!p.compact && <Field label={c.email}><input name="email" type="email" autoComplete="email" dir="ltr" className="input" /></Field>}
      </div>
      {p.showMessage && <Field label={c.message}><textarea name="message" rows={3} maxLength={1000} className="input" /></Field>}
      <label className="flex items-start gap-2 text-sm text-ink-500"><input type="checkbox" name="consent_contact" required className="mt-1" /> {c.consentContact}</label>
      <label className="flex items-start gap-2 text-sm text-ink-500"><input type="checkbox" name="consent_marketing" className="mt-1" /> {c.consentMarketing}</label>
      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Submit label={p.submitLabel ?? (p.kind === "booking" ? c.submitBooking : c.submitCallback)} pending={c.sending} />
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: p } = useFormStatus();
  return (
    <button type="submit" disabled={p} className="w-full rounded-full bg-teal-700 px-6 py-3 font-medium text-white hover:bg-teal-900 disabled:opacity-60">
      {p ? pending : label}
    </button>
  );
}
