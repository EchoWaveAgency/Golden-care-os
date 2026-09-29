import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, rangeStart } from "@/lib/format";
import { FITZPATRICK, REACTION, label, type DeviceParams, type PackageBalance } from "@/lib/devices";
import type { DictKey } from "@/lib/i18n";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { addLaserNote, saveLaserSession } from "@/app/actions/laser";
import { LaserFields } from "./LaserFields";

export const dynamic = "force-dynamic";

type Session = { id: string; ref: string; status: string; device_id: string; service_id: string; fitzpatrick: number | null; checklist: Record<string, string>;
  override_note: string | null; test_spot: boolean; test_spot_pulses: number; test_spot_note: string | null; counter_before: number | null; counter_after: number | null;
  cooling: string | null; reaction: string; reaction_note: string | null; outcome: string | null; follow_up_on: string | null; photo_consent: boolean | null;
  patient_package_id: string | null; signed_at: string | null; signed_by: string | null; operator_id: string };
type AreaRow = { area_code: string; wavelength_nm: number; fluence: number; pulse_width_ms: number | null; spot_mm: number; pulses: number };

export default async function LaserSessionPage({ params, searchParams }: { params: { appointment: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("laser.operate");
  const ar = ctx.locale === "ar";
  const { data: apt } = await ctx.supabase.from("appointments").select("id, ref, slot, status, branch_id, patient_id, specialty_id, doctor:staff(full_name_ar, full_name_en)")
    .eq("id", params.appointment).maybeSingle<{ id: string; ref: string; slot: string; status: string; branch_id: string; patient_id: string; specialty_id: string; doctor: { full_name_ar: string; full_name_en: string | null } | null }>();
  if (!apt) notFound();
  const { data: s } = await ctx.supabase.from("laser_sessions").select("*").eq("appointment_id", apt.id).maybeSingle<Session>();
  const [{ data: dir }, { data: flags }, { data: devices }, { data: services }, { data: pkgs }, { data: checklist }, { data: areas }, { data: rows }, { data: notes }, { data: history }] = await Promise.all([
    ctx.supabase.rpc("patient_directory", { p_ids: [apt.patient_id] }),
    ctx.supabase.rpc("patient_alert_flags", { p_patient: apt.patient_id }),
    ctx.supabase.from("devices").select("id, asset_no, name_ar, name_en, status, counter_unit, counter_value, params").eq("branch_id", apt.branch_id).neq("status", "retired").order("asset_no"),
    ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("specialty_id", apt.specialty_id).eq("is_package", false).eq("is_active", true).order("code"),
    ctx.supabase.rpc("patient_package_balances", { p_patient: apt.patient_id }),
    ctx.supabase.from("laser_checklist_items").select("code, question_ar, question_en, blocking").eq("is_active", true).order("sort_order"),
    ctx.supabase.from("laser_areas").select("code, name_ar, name_en").eq("is_active", true).order("sort_order"),
    s ? ctx.supabase.from("laser_session_areas").select("area_code, wavelength_nm, fluence, pulse_width_ms, spot_mm, pulses").eq("session_id", s.id).returns<AreaRow[]>() : Promise.resolve({ data: [] as AreaRow[] }),
    s ? ctx.supabase.from("laser_session_notes").select("id, kind, note, created_at").eq("session_id", s.id).order("created_at") : Promise.resolve({ data: [] }),
    ctx.supabase.from("laser_sessions").select("id, ref, appointment_id, signed_at, fitzpatrick, reaction").eq("patient_id", apt.patient_id).eq("status", "signed").neq("appointment_id", apt.id)
      .order("signed_at", { ascending: false }).limit(5),
  ]);
  const name = ((dir ?? []) as { full_name_ar: string }[])[0]?.full_name_ar ?? apt.ref;
  const alerts = (flags ?? []) as { kind: string; n: number }[];
  const devs = ((devices ?? []) as { id: string; asset_no: string; name_ar: string; name_en: string; status: string; counter_unit: string | null; counter_value: number; params: DeviceParams }[]);
  const usable = devs.filter((d) => d.status === "active" || d.id === s?.device_id);
  const packages = (pkgs ?? []) as PackageBalance[];
  const areaName = new Map(((areas ?? []) as { code: string; name_ar: string; name_en: string }[]).map((a) => [a.code, ar ? a.name_ar : a.name_en]));
  const signed = s?.status === "signed";
  const ok = { saved: ar ? "تم حفظ المسودة." : "Draft saved.", signed: ar ? "تم توقيع الجلسة وتحديث عداد الجهاز والباقة." : "Session signed; device counter and package updated.", note: ar ? "تمت إضافة الملاحظة." : "Note added." }[searchParams.ok ?? ""];
  const svcName = new Map(((services ?? []) as { id: string; code: string; name_ar: string; name_en: string }[]).map((x) => [x.id, `${x.code} — ${ar ? x.name_ar : x.name_en}`]));
  const dev = devs.find((d) => d.id === s?.device_id);
  const nf = new Intl.NumberFormat("en-US");
  const svcList = (services ?? []) as { id: string; code: string; name_ar: string; name_en: string }[];
  // Default service: the one covered by an active package, else the first laser service.
  const defaultService = s?.service_id ?? packages.find((p) => p.status === "active")?.service_id ?? svcList.find((x) => x.code.startsWith("LASER"))?.id ?? "";

  return (
    <>
      <PageHeader title={`${ar ? "جلسة ليزر" : "Laser session"} · ${name}`}
        subtitle={`${apt.ref} · ${dateTime(rangeStart(apt.slot), ctx.locale)} · ${apt.doctor ? (ar ? apt.doctor.full_name_ar : apt.doctor.full_name_en ?? apt.doctor.full_name_ar) : ""}${s ? ` · ${s.ref}` : ""}`}
        actions={<>
          {ctx.can("inventory.issue") && <Link href={`/os/inventory/issue?appointment=${apt.id}`} className="btn-ghost">{ar ? "صرف مستهلكات" : "Issue consumables"}</Link>}
          <Link href="/os/laser" className="btn-ghost">{ctx.t("common.back")}</Link></>} />
      <Banner error={searchParams.error} success={ok} />
      {alerts.length > 0 && (
        <div role="note" className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-danger/20 bg-danger-50 px-4 py-3">
          <span className="text-sm font-medium text-danger">{ctx.t("patient.alerts")}:</span>
          {alerts.map((a) => <span key={a.kind} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-danger">{ctx.t(`patient.alert.${a.kind}` as DictKey)}</span>)}
        </div>
      )}
      {(history ?? []).length > 0 && (
        <p className="mb-4 text-sm text-ink-500">{ar ? "جلسات سابقة:" : "Previous sessions:"} {(history ?? []).map((h: { id: string; ref: string; appointment_id: string; signed_at: string; fitzpatrick: number | null }, i: number) => (
          <span key={h.id}>{i > 0 ? " · " : ""}<Link href={`/os/laser/${h.appointment_id}`} className="num text-navy-700 hover:underline">{h.ref}</Link> <span className="text-xs">({dateTime(h.signed_at, ctx.locale, { timeStyle: undefined })})</span></span>))}</p>
      )}

      {signed ? (
        <div className="space-y-6">
          <div className="card grid gap-3 p-5 text-sm md:grid-cols-3">
            <p><span className="text-ink-500">{ar ? "الجهاز: " : "Device: "}</span>{dev ? `${dev.asset_no} · ${ar ? dev.name_ar : dev.name_en}` : ""}</p>
            <p><span className="text-ink-500">{ar ? "الخدمة: " : "Service: "}</span>{svcName.get(s!.service_id) ?? ""}</p>
            <p><span className="text-ink-500">{ar ? "نوع البشرة: " : "Skin type: "}</span>Fitzpatrick {FITZPATRICK[(s!.fitzpatrick ?? 1) - 1]}</p>
            <p><span className="text-ink-500">{ar ? "العداد: " : "Counter: "}</span><span className="num" dir="ltr">{s!.counter_before != null ? nf.format(Number(s!.counter_before)) : "—"} → {s!.counter_after != null ? nf.format(Number(s!.counter_after)) : "—"}</span></p>
            <p><span className="text-ink-500">{ar ? "رد الفعل: " : "Reaction: "}</span>{label(REACTION, s!.reaction, ar)}{s!.reaction_note ? ` — ${s!.reaction_note}` : ""}</p>
            <p><span className="text-ink-500">{ar ? "المتابعة: " : "Follow-up: "}</span><span className="num">{s!.follow_up_on ?? "—"}</span></p>
            <p><span className="text-ink-500">{ar ? "موافقة التصوير: " : "Photo consent: "}</span>{s!.photo_consent ? (ar ? "نعم" : "Yes") : (ar ? "لا — لا تُلتقط صور" : "No — no photos")}</p>
            <p><span className="text-ink-500">{ar ? "الباقة: " : "Package: "}</span>{packages.find((p) => p.id === s!.patient_package_id)?.ref ?? (ar ? "بدون — تُفوتر" : "None — invoiced")}</p>
            <p><span className="text-ink-500">{ar ? "التوقيع: " : "Signed: "}</span>{dateTime(s!.signed_at!, ctx.locale)}</p>
            {s!.outcome && <p className="md:col-span-3"><span className="text-ink-500">{ar ? "النتيجة: " : "Outcome: "}</span>{s!.outcome}</p>}
            {s!.override_note && <p className="md:col-span-3 text-danger">{ar ? "تجاوز مانع: " : "Contraindication override: "}{s!.override_note}</p>}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm"><thead className="border-b border-ivory-200 bg-ivory-50"><tr>
              <th className="th">{ar ? "المنطقة" : "Area"}</th><th className="th">nm</th><th className="th">J/cm²</th><th className="th">mm</th><th className="th">ms</th><th className="th">{ar ? "النبضات" : "Pulses"}</th></tr></thead>
              <tbody className="divide-y divide-ivory-200">{(rows ?? []).map((r, i) => (
                <tr key={i}><td className="td">{areaName.get(r.area_code)}</td><td className="td num">{r.wavelength_nm}</td><td className="td num">{Number(r.fluence)}</td>
                  <td className="td num">{Number(r.spot_mm)}</td><td className="td num">{r.pulse_width_ms ?? "—"}</td><td className="td num">{r.pulses}</td></tr>))}
                {s!.test_spot && <tr><td className="td text-ink-500">{ar ? "اختبار" : "Test spot"}</td><td className="td" colSpan={4}>{s!.test_spot_note ?? ""}</td><td className="td num">{s!.test_spot_pulses}</td></tr>}
              </tbody></table>
          </div>
          <section>
            <h2 className="mb-2 font-medium text-navy-700">{ar ? "ملاحظات لاحقة ومتابعة" : "Addenda and follow-up"}</h2>
            <ul className="card mb-3 divide-y divide-ivory-200 text-sm">
              {(notes ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
              {(notes ?? []).map((n: { id: string; kind: string; note: string; created_at: string }) => (
                <li key={n.id} className="px-5 py-3">{n.note}<span className="block text-xs text-ink-300">{n.kind === "adverse_followup" ? (ar ? "متابعة عرض جانبي · " : "Adverse-event follow-up · ") : ""}{dateTime(n.created_at, ctx.locale)}</span></li>))}
            </ul>
            <form action={addLaserNote} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="appointment_id" value={apt.id} /><input type="hidden" name="session_id" value={s!.id} />
              <select name="kind" className="input w-48"><option value="addendum">{ar ? "ملاحظة لاحقة" : "Addendum"}</option><option value="adverse_followup">{ar ? "متابعة عرض جانبي" : "Adverse-event follow-up"}</option></select>
              <input name="note" required className="input flex-1" placeholder={ar ? "الملاحظة" : "Note"} />
              <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إضافة" : "Add"}</SubmitButton>
            </form>
          </section>
        </div>
      ) : usable.length === 0 ? (
        <p className="card p-5 text-sm text-danger">{ar ? "لا يوجد جهاز في الخدمة في هذا الفرع." : "No device in service in this branch."}</p>
      ) : (
        <form action={saveLaserSession} className="card space-y-5 p-5">
          <input type="hidden" name="appointment_id" value={apt.id} />
          <div className="grid gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="service_id">{ar ? "الخدمة *" : "Service *"}</label>
              <select id="service_id" name="service_id" defaultValue={defaultService} className="input" required>
                {((services ?? []) as { id: string; code: string; name_ar: string; name_en: string }[]).map((x) => <option key={x.id} value={x.id}>{x.code} — {ar ? x.name_ar : x.name_en}</option>)}
              </select></div>
            <div><label className="label" htmlFor="patient_package_id">{ar ? "خصم من باقة" : "Redeem from package"}</label>
              <select id="patient_package_id" name="patient_package_id" defaultValue={s?.patient_package_id ?? ""} className="input">
                <option value="">{ar ? "بدون باقة (تُفوتر الجلسة)" : "No package (session is invoiced)"}</option>
                {packages.filter((p) => p.status === "active").map((p) => (
                  <option key={p.id} value={p.id}>{p.ref} · {ar ? p.name_ar : p.name_en} · {ar ? "متبقي" : "left"} {p.units_total - p.units_used}/{p.units_total}
                    {!p.paid ? (ar ? " · غير مسددة" : " · unpaid") : ""}</option>))}
              </select></div>
            <div><label className="label" htmlFor="fitzpatrick">{ar ? "نوع البشرة (فيتزباتريك) *" : "Skin type (Fitzpatrick) *"}</label>
              <select id="fitzpatrick" name="fitzpatrick" defaultValue={s?.fitzpatrick ?? ""} className="input"><option value="">—</option>
                {FITZPATRICK.map((f, i) => <option key={f} value={i + 1}>{f}</option>)}</select></div>
          </div>

          <fieldset className="rounded-lg border border-ivory-200 p-3">
            <legend className="px-1 text-sm font-medium text-navy-700">{ar ? "قائمة الموانع قبل الجلسة *" : "Pre-treatment contraindications *"}</legend>
            <div className="grid gap-2 md:grid-cols-2">
              {((checklist ?? []) as { code: string; question_ar: string; question_en: string; blocking: boolean }[]).map((c) => (
                <div key={c.code} className="flex items-center justify-between gap-3 rounded-md bg-ivory-50 px-3 py-2 text-sm">
                  <span>{ar ? c.question_ar : c.question_en}{c.blocking ? <span className="text-danger"> *</span> : null}</span>
                  <span className="flex shrink-0 gap-3">
                    <label className="flex items-center gap-1"><input type="radio" name={`ck_${c.code}`} value="no" defaultChecked={s?.checklist?.[c.code] === "no"} data-ck={c.code} /> {ar ? "لا" : "No"}</label>
                    <label className="flex items-center gap-1"><input type="radio" name={`ck_${c.code}`} value="yes" defaultChecked={s?.checklist?.[c.code] === "yes"} /> {ar ? "نعم" : "Yes"}</label>
                  </span>
                </div>))}
            </div>
            <p className="mt-2 text-xs text-ink-500">{ar ? "* «نعم» على بند إلزامي يوقف التوقيع إلا بمراجعة طبيب وكتابة السبب." : "* A “yes” on a starred item stops signing unless a doctor reviews it and writes the reason."}</p>
          </fieldset>

          <LaserFields ar={ar} areas={((areas ?? []) as { code: string; name_ar: string; name_en: string }[]).map((a) => ({ code: a.code, name: ar ? a.name_ar : a.name_en }))}
            devices={usable.map((d) => ({ id: d.id, label: `${d.asset_no} · ${ar ? d.name_ar : d.name_en}${d.status !== "active" ? (ar ? " (متوقف)" : " (down)") : ""}`, counter: d.counter_unit ? Number(d.counter_value) : null, params: d.params ?? {} }))}
            initial={{ device_id: s?.device_id ?? "", before: s?.counter_before != null ? String(s.counter_before) : "", after: s?.counter_after != null ? String(s.counter_after) : "",
              test_spot: s?.test_spot ?? false, test_pulses: String(s?.test_spot_pulses ?? 0),
              rows: (rows ?? []).map((r) => ({ area_code: r.area_code, wavelength_nm: String(r.wavelength_nm), fluence: String(Number(r.fluence)), pulse_width_ms: r.pulse_width_ms != null ? String(Number(r.pulse_width_ms)) : "", spot_mm: String(Number(r.spot_mm)), pulses: String(r.pulses) })) }} />

          <div className="grid gap-3 md:grid-cols-3">
            <div><label className="label" htmlFor="cooling">{ar ? "التبريد" : "Cooling"}</label><input id="cooling" name="cooling" defaultValue={s?.cooling ?? ""} className="input" /></div>
            <div><label className="label" htmlFor="reaction">{ar ? "رد فعل الجلد" : "Skin reaction"}</label>
              <select id="reaction" name="reaction" defaultValue={s?.reaction ?? "none"} className="input">{Object.entries(REACTION).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></div>
            <div><label className="label" htmlFor="follow_up_on">{ar ? "موعد المتابعة" : "Follow-up date"}</label><input id="follow_up_on" name="follow_up_on" type="date" defaultValue={s?.follow_up_on ?? ""} className="input" /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="reaction_note">{ar ? "تفاصيل رد الفعل / العرض الجانبي" : "Reaction / adverse event details"}</label><input id="reaction_note" name="reaction_note" defaultValue={s?.reaction_note ?? ""} className="input" /></div>
            <div className="md:col-span-3"><label className="label" htmlFor="outcome">{ar ? "النتيجة والتعليمات" : "Outcome and instructions"}</label><textarea id="outcome" name="outcome" defaultValue={s?.outcome ?? ""} className="input min-h-16" /></div>
            {ctx.can("laser.override") && <div className="md:col-span-3"><label className="label" htmlFor="override_note">{ar ? "سبب المتابعة رغم وجود مانع (للطبيب فقط)" : "Reason to proceed despite a contraindication (doctor only)"}</label><input id="override_note" name="override_note" className="input" /></div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="intent" value="save" pendingLabel="…" className="btn-ghost">{ar ? "حفظ مسودة" : "Save draft"}</SubmitButton>
            <SubmitButton name="intent" value="sign" pendingLabel="…" className="btn-primary">{ar ? "توقيع الجلسة" : "Sign session"}</SubmitButton>
          </div>
          <p className="text-xs text-ink-500">{ar ? "بعد التوقيع لا يمكن تعديل الجلسة؛ تُضاف ملاحظات لاحقة فقط. يتحرك عداد الجهاز وتُخصم جلسة من الباقة ويُسجل القيد تلقائيًا." : "After signing the session cannot change; only addenda can be added. The device counter moves, a package unit is used and the entry is posted automatically."}</p>
        </form>
      )}
    </>
  );
}
