import Link from "next/link";
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
import { savePlan } from "@/app/actions/dental";
import { PLAN_STATUS, label as dlabel } from "@/lib/dental";
import { setFollowup, cancelFollowup } from "@/app/actions/care";

export const dynamic = "force-dynamic";

type Enc = { appointment_id: string | null;
  id: string; ref: string; patient_id: string; status: "draft" | "signed" | "entered_in_error"; doctor_id: string;
  patient_summary: string | null; patient_instructions: string | null; summary_released_at: string | null;
  chief_complaint: string | null; assessment: string | null; plan: string | null; signed_at: string | null; created_at: string;
  patient: { mrn: string; first_name_ar: string; last_name_ar: string; first_name_en: string | null; last_name_en: string | null; date_of_birth: string | null; sex: string } | null;
};

export default async function EncounterPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("clinical.write.own", "clinical.read");
  const { t, locale } = ctx;
  const ar = locale === "ar";

  const { data: e } = await ctx.supabase
    .from("encounters")
    .select("id, ref, patient_id, doctor_id, appointment_id, status, chief_complaint, assessment, plan, signed_at, created_at, patient_summary, patient_instructions, summary_released_at, patient:patients(mrn, first_name_ar, last_name_ar, first_name_en, last_name_en, date_of_birth, sex)")
    .eq("id", params.id)
    .maybeSingle<Enc>();
  if (!e) notFound();

  const [{ data: alerts }, { data: addenda }, { data: plans }, { data: followup }] = await Promise.all([
    ctx.supabase.from("patient_alerts").select("id, kind, severity, label").eq("patient_id", e.patient_id).eq("is_active", true),
    ctx.supabase.from("encounter_addenda").select("id, body, created_at").eq("encounter_id", e.id).order("created_at"),
    ctx.can("plan.write") ? ctx.supabase.from("treatment_plans").select("id, ref, title, status").eq("patient_id", e.patient_id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    ctx.supabase.from("care_followup_requests").select("due_on, note, status").eq("encounter_id", params.id).maybeSingle(),
  ]);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() + 86400_000));
  const signed = e.status !== "draft";
  const canWrite = ctx.can("clinical.write.own");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={patientName(e.patient, locale)}
        subtitle={`${e.patient?.mrn ?? ""} · ${e.ref}${e.patient?.date_of_birth ? ` · ${e.patient.date_of_birth}` : ""}`}
        actions={<>
          {ctx.can("inventory.issue") && e.appointment_id && <Link href={`/os/inventory/issue?appointment=${e.appointment_id}`} className="btn-ghost text-sm">{ar ? "صرف مستهلكات" : "Issue consumables"}</Link>}
          <StatusBadge status={e.status} label={signed ? t("enc.signed") : t("enc.draft")} />
        </>}
      />
      <Banner error={searchParams.error} success={searchParams.ok === "followup_set" ? (ar ? "تم تحديد موعد المتابعة؛ المساعد هيفكّر المريض." : "Follow-up set; the care assistant will remind the patient.")
        : searchParams.ok === "followup_cancelled" ? (ar ? "تم إلغاء المتابعة." : "Follow-up cancelled.") : undefined} />
      {canWrite && e.doctor_id === ctx.staff?.id && e.status !== "entered_in_error" && (
        <section className="mb-5 rounded-xl border border-ivory-300 bg-white p-4" data-followup>
          <p className="mb-2 text-sm font-medium text-navy-700">{ar ? "موعد المتابعة (الاستشارة)" : "Follow-up visit"}</p>
          {followup?.status === "open" && <p className="mb-2 text-sm">{ar ? "مطلوب يوم " : "Requested for "}<span className="num font-medium">{followup.due_on}</span>{followup.note ? ` · ${followup.note}` : ""}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <form action={setFollowup} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="encounter_id" value={e.id} />
              <label><span className="label">{ar ? "التاريخ" : "Date"}</span><input id="followup_due" name="due_on" type="date" min={tomorrow} required defaultValue={followup?.status === "open" ? followup.due_on : ""} className="input" /></label>
              <label><span className="label">{ar ? "ملاحظة داخلية (لا تُرسل للمريض)" : "Internal note (not sent to the patient)"}</span><input name="note" defaultValue={followup?.note ?? ""} className="input w-64" /></label>
              <SubmitButton pendingLabel="…" className="btn-primary">{followup?.status === "open" ? (ar ? "تعديل" : "Update") : (ar ? "طلب متابعة" : "Request follow-up")}</SubmitButton>
            </form>
            {followup?.status === "open" && (
              <form action={cancelFollowup} className="flex items-end gap-2"><input type="hidden" name="encounter_id" value={e.id} />
                <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-40" />
                <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إلغاء المتابعة" : "Cancel follow-up"}</SubmitButton></form>)}
          </div>
        </section>
      )}
      {ctx.can("plan.write") && (
        <section className="mb-5 rounded-xl border border-ivory-300 bg-white p-4" data-plans>
          <p className="mb-2 text-sm font-medium text-navy-700">{ar ? "خطط العلاج" : "Treatment plans"}</p>
          {(plans ?? []).length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {(plans ?? []).map((pl: { id: string; ref: string; title: string; status: string }) => (
                <li key={pl.id}><Link href={`/os/plans/${pl.id}`} className="text-teal-700 hover:underline">{pl.title}</Link> <span className="num text-xs text-ink-300">{pl.ref}</span> · <span className="text-xs text-ink-500">{dlabel(PLAN_STATUS, pl.status, ar)}</span></li>))}
            </ul>)}
          <form action={savePlan} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="patient_id" value={e.patient_id} /><input type="hidden" name="back" value={`/os/encounters/${e.id}`} />
            <input id="plan_title" name="title" required placeholder={ar ? "عنوان خطة جديدة (مثال: حشو وتاج)" : "New plan title (e.g. filling and crown)"} className="input w-72" />
            <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "خطة علاج جديدة" : "New treatment plan"}</SubmitButton>
          </form>
        </section>
      )}

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
