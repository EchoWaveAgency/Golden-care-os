"use client";
import { useFormState } from "react-dom";
import Link from "next/link";
import { createPatient } from "@/app/actions/patients";
import { SubmitButton } from "@/components/SubmitButton";

type L = Record<string, string>;

export function PatientForm({ l }: { l: L }) {
  const [state, action] = useFormState(createPatient, undefined);
  const dups = state?.duplicates ?? [];
  return (
    <form action={action} className="card space-y-6 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="first_name_ar" label={l.firstAr} required />
        <Field name="last_name_ar" label={l.lastAr} required />
        <Field name="first_name_en" label={l.firstEn} dir="ltr" />
        <Field name="last_name_en" label={l.lastEn} dir="ltr" />
        <Field name="phone_raw" label={l.phone} required dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx" />
        <Field name="national_id" label={l.nationalId} dir="ltr" inputMode="numeric" maxLength={14} />
        <Field name="date_of_birth" label={l.dob} type="date" />
        <div>
          <label className="label" htmlFor="sex">{l.sex}</label>
          <select id="sex" name="sex" className="input" defaultValue="unknown">
            <option value="female">{l.female}</option>
            <option value="male">{l.male}</option>
            <option value="unknown">{l.unknown}</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="preferred_channel">{l.channel}</label>
          <select id="preferred_channel" name="preferred_channel" className="input" defaultValue="whatsapp">
            <option value="whatsapp">WhatsApp</option>
            <option value="call">{l.call}</option>
            <option value="sms">SMS</option>
            <option value="none">—</option>
          </select>
        </div>
        <Field name="email" label="Email" type="email" dir="ltr" />
      </div>

      {state?.error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{state.error}</p>}

      {dups.length > 0 && (
        <div role="alert" className="rounded-xl border border-warn/30 bg-warn-50 p-4">
          <p className="font-medium text-warn">{l.duplicates}</p>
          <p className="mt-1 text-sm text-ink-500">{l.duplicatesHint}</p>
          <ul className="mt-3 divide-y divide-warn/20">
            {dups.map((d) => (
              <li key={d.patient_id} className="flex items-center justify-between py-2 text-sm">
                <span><span className="font-medium">{d.full_name}</span> <span className="num text-ink-500">· {d.mrn} · {d.phone}</span></span>
                <Link href={`/patients/${d.patient_id}`} className="text-teal-700 hover:underline">{l.open}</Link>
              </li>
            ))}
          </ul>
          <input type="hidden" name="confirm_new" value="1" />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Link href="/patients" className="btn-ghost">{l.cancel}</Link>
        <SubmitButton pendingLabel={l.loading} className={dups.length ? "btn-gold" : "btn-primary"}>
          {dups.length ? l.registerAnyway : l.save}
        </SubmitButton>
      </div>
    </form>
  );
}

function Field({ label, name, ...rest }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}{rest.required && <span className="text-danger"> *</span>}</label>
      <input id={name} name={name} className="input" {...rest} />
    </div>
  );
}
