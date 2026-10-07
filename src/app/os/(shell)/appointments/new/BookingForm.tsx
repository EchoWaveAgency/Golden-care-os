"use client";
import { useFormState } from "react-dom";
import { bookAppointment } from "@/app/actions/appointments";
import { SubmitButton } from "@/components/SubmitButton";
import { FormMessage } from "@/components/FormMessage";

type Doctor = { id: string; name: string; specialty: string };

export function BookingForm({ patientId, doctors, today, idempotencyKey, l, devices = [] }: {
  patientId: string; doctors: Doctor[]; today: string; idempotencyKey: string; l: Record<string, string>; devices?: { id: string; name: string }[];
}) {
  const [state, action] = useFormState(bookAppointment, undefined);
  return (
    <form action={action} className="card grid gap-4 p-6 sm:grid-cols-2">
      <input type="hidden" name="patient_id" value={patientId} />
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <div className="sm:col-span-2">
        <label className="label" htmlFor="doctor_id">{l.doctor}</label>
        <select id="doctor_id" name="doctor_id" required className="input">
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.specialty}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="date">{l.date}</label>
        <input id="date" name="date" type="date" required defaultValue={today} min={today} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="time">{l.time}</label>
        <input id="time" name="time" type="time" required step={300} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="minutes">{l.duration}</label>
        <select id="minutes" name="minutes" className="input" defaultValue="15">
          {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="channel">{l.channel}</label>
        <select id="channel" name="channel" className="input" defaultValue="front_desk">
          <option value="front_desk">{l.ch_front_desk}</option>
          <option value="phone">{l.ch_phone}</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="walk_in">{l.ch_walk_in}</option>
          <option value="social">{l.ch_social}</option>
          <option value="referral">{l.ch_referral}</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        {devices.length > 0 && <><label className="label" htmlFor="device_id">{l.device}</label>
          <select id="device_id" name="device_id" className="input mb-3"><option value="">—</option>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></>}
        <label className="label" htmlFor="notes_admin">{l.notes}</label>
        <input id="notes_admin" name="notes_admin" className="input" maxLength={500} />
      </div>
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton pendingLabel={l.loading}>{l.submit}</SubmitButton>
      </div>
    </form>
  );
}
