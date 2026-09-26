"use client";
import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { portalBook } from "@/app/actions/portal";

type Doc = { id: string; name: string; title: string; specialtySlug: string | null; specialty: string };
type Slot = { slot_start: string; slot_end: string };
const cairoDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);

function Send({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={disabled || pending} className="btn-primary w-full justify-center disabled:opacity-50">{pending ? "…" : label}</button>;
}

export function PortalBooking({ lang, doctors, specialties }: { lang: "ar" | "en"; doctors: Doc[]; specialties: { slug: string; title: string }[] }) {
  const ar = lang === "ar";
  const [spec, setSpec] = useState("");
  const [docId, setDocId] = useState("");
  const [from, setFrom] = useState(cairoDate());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState("");
  const list = useMemo(() => doctors.filter((d) => !spec || d.specialtySlug === spec), [doctors, spec]);
  const doc = doctors.find((d) => d.id === docId);

  useEffect(() => {
    setSlot(""); setSlots(null);
    if (!docId) return;
    let alive = true;
    fetch(`/api/public/slots?doctor=${docId}&from=${from}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => alive && setSlots(j.slots ?? [])).catch(() => alive && setSlots([]));
    return () => { alive = false; };
  }, [docId, from]);

  const loc = ar ? "ar-EG-u-nu-latn" : "en-GB";
  const fmtDay = (iso: string) => new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" }).format(new Date(iso));
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(iso));
  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    (slots ?? []).forEach((s) => { const k = cairoDate(new Date(s.slot_start)); m.set(k, [...(m.get(k) ?? []), s]); });
    return Array.from(m.entries());
  }, [slots]);
  const shift = (n: number) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); const v = d.toISOString().slice(0, 10); if (v >= cairoDate()) setFrom(v); };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-ivory-300/70 bg-white p-5">
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "1. التخصص والطبيب" : "1. Specialty and doctor"}</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip on={spec === ""} onClick={() => setSpec("")}>{ar ? "الكل" : "All"}</Chip>
          {specialties.map((s) => <Chip key={s.slug} on={spec === s.slug} onClick={() => { setSpec(s.slug); setDocId(""); }}>{s.title}</Chip>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((d) => (
            <button key={d.id} type="button" onClick={() => setDocId(d.id)}
              className={`rounded-xl border p-3 text-start transition ${docId === d.id ? "border-teal-700 bg-teal-50" : "border-ivory-300 hover:border-teal-700"}`}>
              <span className="block font-medium text-navy-700">{d.name}</span>
              <span className="block text-xs text-ink-500">{d.specialty}{d.title ? ` · ${d.title}` : ""}</span>
            </button>
          ))}
        </div>
      </section>

      {doc && (
        <section className="rounded-2xl border border-ivory-300/70 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-navy-700">{ar ? "2. اختر الوقت" : "2. Choose a time"}</h2>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => shift(-7)} className="rounded-full px-3 py-1 text-sm text-teal-700 hover:bg-teal-50" aria-label={ar ? "الأسبوع السابق" : "Previous week"}>{ar ? "→" : "←"}</button>
              <button type="button" onClick={() => shift(7)} className="rounded-full px-3 py-1 text-sm text-teal-700 hover:bg-teal-50" aria-label={ar ? "الأسبوع التالي" : "Next week"}>{ar ? "←" : "→"}</button>
            </div>
          </div>
          {slots === null ? <p className="text-sm text-ink-300">…</p> : days.length === 0 ? <p className="text-sm text-ink-500">{ar ? "لا توجد مواعيد متاحة هذا الأسبوع. جرّب الأسبوع التالي." : "No free times this week. Try the next week."}</p> : (
            <div className="space-y-4">
              {days.map(([d, ss]) => (
                <div key={d}>
                  <p className="mb-2 text-sm font-medium">{fmtDay(ss[0].slot_start)}</p>
                  <div className="flex flex-wrap gap-2">
                    {ss.map((s) => (
                      <button key={s.slot_start} type="button" onClick={() => setSlot(s.slot_start)} aria-pressed={slot === s.slot_start}
                        className={`whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm ${slot === s.slot_start ? "border-teal-700 bg-teal-700 text-white" : "border-ivory-300 hover:border-teal-700"}`}>{fmtTime(s.slot_start)}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <form action={portalBook} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="doctor" value={docId} />
        <input type="hidden" name="start" value={slot} />
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "3. التأكيد" : "3. Confirm"}</h2>
        {doc && slot ? <p className="mb-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">{doc.name} · {fmtDay(slot)} · <span className="whitespace-nowrap">{fmtTime(slot)}</span></p>
          : <p className="mb-3 text-sm text-ink-500">{ar ? "اختر الطبيب والوقت أولًا." : "Choose a doctor and a time first."}</p>}
        <textarea name="note" rows={2} maxLength={500} className="input mb-3" placeholder={ar ? "سبب الزيارة أو ملاحظة (اختياري)" : "Reason for visit or a note (optional)"} />
        <Send label={ar ? "إرسال طلب الحجز" : "Send booking request"} disabled={!doc || !slot} />
        <p className="mt-3 text-xs leading-6 text-ink-300">{ar ? "يُحجز الوقت لك مؤقتًا ويؤكده فريقنا. السعر النهائي يُحدد في العيادة حسب الخدمة." : "The time is held for you and confirmed by our team. The final price is set at the clinic according to the service."}</p>
      </form>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm ${on ? "border-teal-700 bg-teal-700 text-white" : "border-ivory-300 bg-white text-navy-700 hover:border-teal-700"}`}>{children}</button>;
}
