"use client";
import { useEffect, useMemo, useState } from "react";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";
import { InquiryForm } from "./InquiryForm";

type Spec = { slug: string; title: string };
type Doc = { id: string; slug: string; name: string; specialtySlug: string | null; title: string; online: boolean };
type Slot = { slot_start: string; slot_end: string };

function cairoDate(d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d); }

export function BookingWizard({ lang, specialties, doctors, initialSpecialty, initialDoctor, offerSlug }: {
  lang: Lang; specialties: Spec[]; doctors: Doc[]; initialSpecialty?: string; initialDoctor?: string; offerSlug?: string;
}) {
  const c = copy(lang);
  const [spec, setSpec] = useState(initialSpecialty ?? doctors.find((d) => d.slug === initialDoctor)?.specialtySlug ?? "");
  const [docSlug, setDocSlug] = useState(initialDoctor ?? "");
  const [from, setFrom] = useState(cairoDate());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string>("");
  const doc = doctors.find((d) => d.slug === docSlug);
  const list = useMemo(() => doctors.filter((d) => d.online && (!spec || d.specialtySlug === spec)), [doctors, spec]);

  useEffect(() => {
    setSlot(""); setSlots(null);
    if (!doc) return;
    let alive = true;
    fetch(`/api/public/slots?doctor=${doc.id}&from=${from}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (alive) setSlots(j.slots ?? []); }).catch(() => alive && setSlots([]));
    return () => { alive = false; };
  }, [doc, from]);

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    (slots ?? []).forEach((s) => {
      const k = cairoDate(new Date(s.slot_start));
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return Array.from(m.entries());
  }, [slots]);
  const fmtDay = (d: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" }).format(new Date(`${d}T12:00:00+02:00`));
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(iso));
  const shift = (n: number) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); const v = d.toISOString().slice(0, 10); if (v >= cairoDate()) setFrom(v); };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Step n={1} title={c.step1}>
          <div className="flex flex-wrap gap-2">
            {specialties.map((s) => (
              <button key={s.slug} type="button" onClick={() => { setSpec(s.slug); setDocSlug(""); }}
                className={`rounded-full border px-4 py-2 text-sm transition ${spec === s.slug ? "border-teal-700 bg-teal-700 text-white" : "border-ivory-300 bg-white text-navy-700 hover:border-teal-700"}`}>{s.title}</button>
            ))}
          </div>
        </Step>
        <Step n={2} title={c.step2}>
          {list.length === 0 ? <p className="text-sm text-ink-500">{c.noSlots}</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((d) => (
                <button key={d.slug} type="button" onClick={() => setDocSlug(d.slug)}
                  className={`rounded-xl border p-4 text-start transition ${docSlug === d.slug ? "border-teal-700 bg-teal-50" : "border-ivory-300 bg-white hover:border-teal-700"}`}>
                  <span className="block font-medium text-navy-700">{d.name}</span>
                  <span className="block text-xs text-ink-500">{d.title}</span>
                </button>
              ))}
            </div>
          )}
        </Step>
        {doc && (
          <Step n={3} title={c.step3}>
            <div className="mb-3 flex items-center justify-between">
              <button type="button" onClick={() => shift(-7)} className="rounded-full px-3 py-1 text-sm text-teal-700 hover:bg-teal-50" aria-label="previous week">{lang === "ar" ? "→" : "←"}</button>
              <span className="text-sm text-ink-500">{fmtDay(from)}</span>
              <button type="button" onClick={() => shift(7)} className="rounded-full px-3 py-1 text-sm text-teal-700 hover:bg-teal-50" aria-label="next week">{lang === "ar" ? "←" : "→"}</button>
            </div>
            {slots === null ? <p className="text-sm text-ink-300">…</p> : days.length === 0 ? <p className="text-sm text-ink-500">{c.noSlots}</p> : (
              <div className="space-y-4">
                {days.map(([d, ss]) => (
                  <div key={d}>
                    <p className="mb-2 text-sm font-medium text-navy-700">{fmtDay(d)}</p>
                    <div className="flex flex-wrap gap-2">
                      {ss.map((s) => (
                        <button key={s.slot_start} type="button" onClick={() => setSlot(s.slot_start)}
                          className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm transition ${slot === s.slot_start ? "border-teal-700 bg-teal-700 text-white" : "border-ivory-300 bg-white hover:border-teal-700"}`}>{fmtTime(s.slot_start)}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Step>
        )}
      </div>
      <aside className="lg:col-span-2">
        <div className="sticky top-28 rounded-2xl border border-ivory-300/70 bg-white p-6 shadow-card">
          <h2 className="mb-1 text-lg font-semibold text-navy-700">{c.step4}</h2>
          {doc && slot ? (
            <p className="mb-4 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{doc.name} · {fmtDay(cairoDate(new Date(slot)))} · <span className="whitespace-nowrap">{fmtTime(slot)}</span></p>
          ) : <p className="mb-4 text-sm text-ink-500">{c.chooseTime}</p>}
          <InquiryForm key={slot || "none"} lang={lang} kind={slot ? "booking" : "callback"} specialtySlug={spec || undefined}
            doctorSlug={docSlug || undefined} preferredStart={slot || undefined} offerSlug={offerSlug} compact showMessage
            submitLabel={slot ? c.submitBooking : c.submitCallback} />
          <p className="mt-4 text-xs leading-6 text-ink-300">{c.bookingNote}</p>
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ivory-300/70 bg-white p-6">
      <h2 className="mb-4 flex items-center gap-3 font-semibold text-navy-700">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gold-500 text-sm text-white">{n}</span>{title}
      </h2>
      {children}
    </section>
  );
}
