import Image from "next/image";

export type RxSheetData = {
  rxRef: string; date: string | null; patientName: string; mrn: string; doctorName: string; specialty: string; notes: string | null;
  items: { drug: string; strength: string | null; form: string | null; dose: string; frequency: string; duration: string | null; instructions: string | null }[];
  allergies?: string[]; lang: "ar" | "en"; address?: string | null;
};

// Printable prescription (A5-friendly), used by staff and by the patient portal.
export function RxSheet(d: RxSheetData) {
  const ar = d.lang === "ar";
  const date = d.date ? new Intl.DateTimeFormat(ar ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "long", timeZone: "Africa/Cairo" }).format(new Date(d.date)) : "";
  return (
    <article className="mx-auto max-w-2xl bg-white p-8 text-ink print:p-0">
      <header className="flex items-center justify-between border-b-2 border-gold-500 pb-4">
        <div>
          <p className="text-xl font-semibold text-navy-700">{ar ? "عيادات جولدن كير" : "Golden Care Clinics"}</p>
          <p className="text-sm text-ink-500">{d.doctorName}{d.specialty ? ` — ${d.specialty}` : ""}</p>
          {d.address && <p className="text-xs text-ink-300">{d.address}</p>}
        </div>
        <Image src="/brand/emblem.png" alt="" width={90} height={57} />
      </header>
      <section className="my-4 grid grid-cols-2 gap-2 text-sm">
        <p><span className="text-ink-500">{ar ? "المريض:" : "Patient:"}</span> {d.patientName}</p>
        <p className="text-end"><span className="text-ink-500">{ar ? "التاريخ:" : "Date:"}</span> {date}</p>
        <p><span className="text-ink-500">{ar ? "رقم الملف:" : "MRN:"}</span> <span className="num">{d.mrn}</span></p>
        <p className="text-end"><span className="text-ink-500">{ar ? "رقم الروشتة:" : "Rx:"}</span> <span className="num">{d.rxRef}</span></p>
      </section>
      {d.allergies && d.allergies.length > 0 && (
        <p className="mb-4 rounded bg-danger-50 px-3 py-2 text-sm text-danger">{ar ? "حساسية مسجلة:" : "Recorded allergy:"} {d.allergies.join("، ")}</p>
      )}
      <p className="mb-2 text-3xl font-semibold text-gold-700" dir="ltr">℞</p>
      <ol className="space-y-3">
        {d.items.map((i, n) => (
          <li key={n} className="border-b border-ivory-200 pb-2">
            <p className="font-medium" dir="ltr">{n + 1}. {i.drug} {[i.strength, i.form].filter(Boolean).join(" ")}</p>
            <p className="text-sm">{i.dose} — {i.frequency}{i.duration ? ` — ${i.duration}` : ""}</p>
            {i.instructions && <p className="text-xs text-ink-500">{i.instructions}</p>}
          </li>
        ))}
      </ol>
      {d.notes && <p className="mt-4 whitespace-pre-wrap text-sm">{d.notes}</p>}
      <footer className="mt-10 flex items-end justify-between text-xs text-ink-300">
        <span>{ar ? "روشتة موقّعة إلكترونيًا في نظام جولدن كير" : "Electronically signed in Golden Care OS"}</span>
        <span className="border-t border-ink-300 px-8 pt-1">{ar ? "توقيع الطبيب" : "Doctor's signature"}</span>
      </footer>
    </article>
  );
}
