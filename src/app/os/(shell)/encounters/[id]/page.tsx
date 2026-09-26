import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { patientName } from "@/lib/types";
import { saveEncounter, addAddendum, addAlert } from "@/app/actions/clinical";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";
import type { DictKey } from "@/lib/i18n";
import { PrescriptionsPanel, ReleasePanel } from "./Panels";

export const dynamic = "force-dynamic";

type Enc = {
  id: string; ref: string; patient_id: string; status: "draft" | "signed" | "entered_in_error"; doctor_id: string;
  patient_summary: string | null; patient_instructions: string | null; summary_released_at: string | null;
  chief_complaint: string | null; assessment: string | null; plan: string | null; signed_at: string | null; created_at: string;
  patient: { mrn: string; first_name_ar: string; last_name_ar: string; first_name_en: string | null; last_name_en: string | null; date_of_birth: string | null; sex: string } | null;
};

export default async function EncounterPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const ctx = await requireAny("clinical.write.own", "clinical.read");
  const { t, locale } = ctx;
  const ar = locale === "ar";

  const { data: e } = await ctx.supabase
    .from("encounters")
    .select("id, ref, patient_id, doctor_id, status, chief_complaint, assessment, plan, signed_at, created_at, patient_summary, patient_instructions, summary_released_at, patient:patients(mrn, first_name_ar, last_name_ar, first_name_en, last_name_en, date_of_birth, sex)")
    .eq("id", params.id)
    .maybeSingle<Enc>();
  if (!e) notFound();

  const [{ data: alerts }, { data: addenda }] = await Promise.all([
    ctx.supabase.from("patient_alerts").select("id, kind, severity, label").eq("patient_id", e.patient_id).eq("is_active", true),
    ctx.supabase.from("encounter_addenda").select("id, body, created_at").eq("encounter_id", e.id).order("created_at"),
  ]);
  const signed = e.status !== "draft";
  const canWrite = ctx.can("clinical.write.own");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={patientName(e.patient, locale)}
        subtitle={`${e.patient?.mrn ?? ""} · ${e.ref}${e.patient?.date_of_birth ? ` · ${e.patient.date_of_birth}` : ""}`}
        actions={<StatusBadge status={e.status} label={signed ? t("enc.signed") : t("enc.draft")} />}
      />
      <Banner error={searchParams.error} />

      <section className={`mb-5 rounded-xl border p-4 ${(alerts ?? []).length ? "border-danger/30 bg-danger-50" : "border-ivory-300 bg-white"}`}>
        <p className="mb-2 text-sm font-medium text-danger">{t("patient.alerts")}</p>
        {(alerts ?? []).length === 0 ? <p className="text-sm text-ink-500">{ar ? "لا توجد تنبيهات مسجلة." : "No alerts on file."}</p> : (
          <ul className="flex flex-wrap gap-2">
            {(alerts ?? []).map((a) => (
              <li key={a.id} className={`rounded-full px-3 py-1 text-xs font-medium ${a.severity === "high" ? "bg-danger text-white" : "bg-white text-danger"}`}>
                {t(`patient.alert.${a.kind}` as DictKey)}: {a.label}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-teal-700">{ar ? "+ إضافة تنبيه" : "+ Add alert"}</summary>
            <form action={addAlert} className="mt-2 grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="encounter_id" value={e.id} />
              <input type="hidden" name="patient_id" value={e.patient_id} />
              <select name="kind" className="input">
                {["allergy", "chronic_condition", "medication", "contraindication", "pregnancy", "other"].map((k) => (
                  <option key={k} value={k}>{t(`patient.alert.${k}` as DictKey)}</option>
                ))}
              </select>
              <select name="severity" className="input" defaultValue="moderate">
                <option value="high">{ar ? "عالي" : "High"}</option>
                <option value="moderate">{ar ? "متوسط" : "Moderate"}</option>
                <option value="info">{ar ? "معلومة" : "Info"}</option>
              </select>
              <input name="label" required minLength={2} className="input" placeholder={ar ? "مثال: بنسلين" : "e.g. Penicillin"} />
              <SubmitButton pendingLabel="…" className="btn-danger">{t("common.save")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {signed ? (
        <section className="card space-y-5 p-6">
          <p className="rounded-lg bg-ivory-200 px-3 py-2 text-sm text-ink-500">{t("enc.signedLocked")}</p>
          <ReadBlock label={t("enc.chief")} value={e.chief_complaint} />
          <ReadBlock label={t("enc.assessment")} value={e.assessment} />
          <ReadBlock label={t("enc.plan")} value={e.plan} />
          {e.signed_at && <p className="num text-xs text-ink-300">{t("enc.signed")}: {dateTime(e.signed_at, locale)}</p>}
        </section>
      ) : (
        <form action={saveEncounter} className="card space-y-5 p-6">
          <input type="hidden" name="id" value={e.id} />
          <Area name="chief_complaint" label={t("enc.chief")} value={e.chief_complaint} rows={2} />
          <Area name="assessment" label={t("enc.assessment")} value={e.assessment} rows={4} />
          <Area name="plan" label={t("enc.plan")} value={e.plan} rows={4} />
          {canWrite && (
            <div className="flex flex-wrap justify-end gap-2">
              <SubmitButton name="intent" value="save" pendingLabel={t("common.loading")} className="btn-ghost">{t("common.save")}</SubmitButton>
              <SubmitButton name="intent" value="sign" pendingLabel={t("common.loading")} className="btn-primary"
                confirm={ar ? "بعد التوقيع لا يمكن تعديل الكشف. متابعة؟" : "After signing, the encounter cannot be edited. Continue?"}>
                {t("enc.sign")}
              </SubmitButton>
            </div>
          )}
        </form>
      )}

      {signed && (
        <section className="card mt-5 p-6">
          <h2 className="mb-3 font-medium text-navy-700">{t("enc.addendum")}</h2>
          <ul className="mb-4 space-y-3">
            {(addenda ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border border-ivory-300 p-3 text-sm">
                <p className="whitespace-pre-wrap">{a.body}</p>
                <p className="mt-1 text-xs text-ink-300 whitespace-nowrap">{dateTime(a.created_at, locale)}</p>
              </li>
            ))}
          </ul>
          {canWrite && (
            <form action={addAddendum} className="space-y-2">
              <input type="hidden" name="encounter_id" value={e.id} />
              <textarea name="body" required rows={3} className="input" />
              <div className="flex justify-end"><SubmitButton pendingLabel="…">{t("enc.addendum")}</SubmitButton></div>
            </form>
          )}
        </section>
      )}
      <PrescriptionsPanel ctx={ctx} encounterId={e.id} isOwner={canWrite && e.doctor_id === ctx.staff?.id}
        hasAllergies={(alerts ?? []).some((a) => a.kind === "allergy")} />
      <ReleasePanel ctx={ctx} encounterId={e.id} signed={signed} releasedAt={e.summary_released_at} summary={e.patient_summary}
        instructions={e.patient_instructions} canRelease={(canWrite && e.doctor_id === ctx.staff?.id) || ctx.can("clinical.release")} />
    </div>
  );
}

function Area({ name, label, value, rows }: { name: string; label: string; value: string | null; rows: number }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <textarea id={name} name={name} rows={rows} defaultValue={value ?? ""} className="input" />
    </div>
  );
}

function ReadBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="whitespace-pre-wrap text-sm">{value || "—"}</p>
    </div>
  );
}
