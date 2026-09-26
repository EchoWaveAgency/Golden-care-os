import Link from "next/link";
import type { Ctx } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { addPrescriptionItem, createPrescription, releaseToPatient, removePrescriptionItem, signPrescription } from "@/app/actions/rx";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusBadge } from "@/components/StatusBadge";

type Rx = { id: string; ref: string; status: string; signed_at: string | null; released_at: string | null; allergy_ack: boolean;
  items: { id: string; drug_name: string; strength: string | null; form: string | null; dose: string; frequency: string; duration: string | null; instructions: string | null }[] };

export async function PrescriptionsPanel({ ctx, encounterId, isOwner, hasAllergies }: { ctx: Ctx; encounterId: string; isOwner: boolean; hasAllergies: boolean }) {
  const ar = ctx.locale === "ar";
  const [{ data: rxs }, { data: drugs }] = await Promise.all([
    ctx.supabase.from("prescriptions").select("id, ref, status, signed_at, released_at, allergy_ack, items:prescription_items(id, drug_name, strength, form, dose, frequency, duration, instructions)")
      .eq("encounter_id", encounterId).order("created_at").returns<Rx[]>(),
    ctx.supabase.from("drugs").select("trade_name, strength, form, is_restricted").eq("is_active", true).order("trade_name").limit(500),
  ]);
  return (
    <section className="card mt-5 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-navy-700">{ar ? "الروشتة" : "Prescriptions"}</h2>
        {isOwner && (
          <form action={createPrescription}>
            <input type="hidden" name="encounter_id" value={encounterId} />
            <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "روشتة جديدة" : "New prescription"}</SubmitButton>
          </form>
        )}
      </div>
      <datalist id="drug-list">
        {(drugs ?? []).map((d) => <option key={`${d.trade_name}${d.strength}${d.form}`} value={`${d.trade_name} — ${[d.strength, d.form].filter(Boolean).join(" ")}${d.is_restricted ? " ⚠" : ""}`} />)}
      </datalist>
      {(rxs ?? []).length === 0 && <p className="text-sm text-ink-300">{ar ? "لا توجد روشتة لهذا الكشف." : "No prescription for this encounter."}</p>}
      <div className="space-y-5">
        {(rxs ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border border-ivory-300 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="num text-sm font-medium">{r.ref}</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status === "signed" ? "signed" : "draft"} label={r.status === "signed" ? (ar ? "موقّعة" : "Signed") : (ar ? "مسودة" : "Draft")} />
                {r.released_at && <span className="text-xs text-ok">{ar ? "ظاهرة للمريض" : "Visible to patient"}</span>}
                {r.status === "signed" && <Link href={`/os/prescriptions/${r.id}/print`} target="_blank" className="text-xs text-teal-700 hover:underline">{ctx.t("common.print")}</Link>}
              </div>
            </div>
            <ul className="mb-3 divide-y divide-ivory-200 text-sm">
              {r.items.map((i, n) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                  <span><span className="font-medium">{n + 1}. {i.drug_name}</span> {[i.strength, i.form].filter(Boolean).join(" ")} — {i.dose} · {i.frequency}{i.duration ? ` · ${i.duration}` : ""}{i.instructions ? <span className="block text-xs text-ink-500">{i.instructions}</span> : null}</span>
                  {isOwner && r.status === "draft" && (
                    <form action={removePrescriptionItem}><input type="hidden" name="encounter_id" value={encounterId} /><input type="hidden" name="item_id" value={i.id} /><button className="text-xs text-danger">✕</button></form>
                  )}
                </li>
              ))}
            </ul>
            {isOwner && r.status === "draft" && (
              <>
                <form key={r.items.length} action={addPrescriptionItem} className="grid gap-2 sm:grid-cols-6">
                  <input type="hidden" name="encounter_id" value={encounterId} />
                  <input type="hidden" name="prescription_id" value={r.id} />
                  <input name="drug" list="drug-list" required placeholder={ar ? "اسم الدواء" : "Medicine"} className="input sm:col-span-2" dir="ltr" />
                  <input name="dose" required placeholder={ar ? "الجرعة" : "Dose"} className="input" />
                  <input name="frequency" required placeholder={ar ? "عدد المرات" : "Frequency"} className="input" />
                  <input name="duration" placeholder={ar ? "المدة" : "Duration"} className="input" />
                  <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إضافة" : "Add"}</SubmitButton>
                  <input name="instructions" placeholder={ar ? "تعليمات للمريض (اختياري)" : "Instructions (optional)"} className="input sm:col-span-6" />
                </form>
                <form action={signPrescription} className="mt-3 flex flex-wrap items-center gap-3">
                  <input type="hidden" name="encounter_id" value={encounterId} />
                  <input type="hidden" name="prescription_id" value={r.id} />
                  {hasAllergies && (
                    <label className="flex items-center gap-2 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
                      <input type="checkbox" name="ack" /> {ar ? "راجعت الحساسية المسجلة وأؤكد ملاءمة الأدوية" : "I reviewed the recorded allergy and confirm these medicines are appropriate"}
                    </label>
                  )}
                  <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "توقيع الروشتة" : "Sign prescription"}</SubmitButton>
                </form>
              </>
            )}
            {r.status === "signed" && !r.released_at && (isOwner || ctx.can("clinical.release")) && (
              <form action={releaseToPatient} className="mt-3">
                <input type="hidden" name="encounter_id" value={encounterId} />
                <input type="hidden" name="kind" value="prescription" />
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton pendingLabel="…" className="btn-ghost">{ar ? "إظهار للمريض في حسابه" : "Release to patient portal"}</SubmitButton>
              </form>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReleasePanel({ ctx, encounterId, signed, releasedAt, summary, instructions, canRelease }: {
  ctx: Ctx; encounterId: string; signed: boolean; releasedAt: string | null; summary: string | null; instructions: string | null; canRelease: boolean;
}) {
  const ar = ctx.locale === "ar";
  if (!signed) return null;
  return (
    <section className="card mt-5 p-6">
      <h2 className="mb-3 font-medium text-navy-700">{ar ? "ملخص الزيارة للمريض" : "Visit summary for the patient"}</h2>
      {releasedAt ? (
        <div className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap">{summary}</p>
          {instructions && <p className="whitespace-pre-wrap text-ink-500">{instructions}</p>}
          <p className="text-xs text-ok">{ar ? "ظاهر في حساب المريض منذ" : "Visible in the patient account since"} {dateTime(releasedAt, ctx.locale)}</p>
        </div>
      ) : canRelease ? (
        <form action={releaseToPatient} className="space-y-3">
          <input type="hidden" name="encounter_id" value={encounterId} />
          <input type="hidden" name="kind" value="encounter" />
          <input type="hidden" name="id" value={encounterId} />
          <p className="text-xs text-ink-500">{ar ? "اكتب ملخصًا بلغة بسيطة. الملاحظات الداخلية والتقييم الطبي لا تظهر للمريض أبدًا." : "Write a plain-language summary. Internal notes and assessment are never shown to the patient."}</p>
          <textarea name="summary" required rows={3} className="input" placeholder={ar ? "الملخص" : "Summary"} />
          <textarea name="instructions" rows={2} className="input" placeholder={ar ? "تعليمات المتابعة" : "Follow-up instructions"} />
          <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إظهار للمريض" : "Release to patient"}</SubmitButton>
        </form>
      ) : <p className="text-sm text-ink-300">{ar ? "لم يتم الإفراج بعد." : "Not released yet."}</p>}
    </section>
  );
}
