import { randomUUID } from "node:crypto";
import { dateTime } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { uploadPatientFile, reviewPatientFile, releasePatientFile, voidPatientFile } from "@/app/actions/files";
import type { Locale } from "@/lib/i18n";

export type PFile = { id: string; ref: string; kind: string; clinical: boolean; title: string; taken_on: string | null; body_area: string | null; photo_stage: string | null;
  content_type: string; created_at: string; uploaded_by: string; reviewed_at: string | null; abnormal: boolean | null; review_note: string | null;
  released_at: string | null; release_note: string | null };

export const FILE_KIND: Record<string, [string, string]> = {
  lab_result: ["نتيجة تحليل", "Lab result"], radiology: ["أشعة", "Radiology"], medical_report: ["تقرير طبي", "Medical report"], photo: ["صورة إكلينيكية", "Clinical photo"],
  consent_form: ["إقرار موقّع", "Signed consent"], id_document: ["إثبات شخصية", "ID document"], insurance: ["تأمين", "Insurance"], other: ["أخرى", "Other"],
};
const STAGE: Record<string, [string, string]> = { before: ["قبل", "Before"], after: ["بعد", "After"], progress: ["متابعة", "Progress"] };

export function PatientFiles({ patientId, files, locale, userId, canUpload, canManage, appointments }: {
  patientId: string; files: PFile[]; locale: Locale; userId: string; canUpload: boolean; canManage: boolean;
  appointments: { id: string; label: string }[];
}) {
  const ar = locale === "ar";
  const photos = files.filter((f) => f.kind === "photo");
  const areas = Array.from(new Set(photos.map((p) => p.body_area ?? (ar ? "بدون منطقة" : "No area"))));
  const others = files.filter((f) => f.kind !== "photo");
  return (
    <section className="card lg:col-span-3" data-patient-files>
      <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{ar ? "الملفات والنتائج والصور" : "Files, results and photos"}</h2>
      {others.length > 0 && (
        <ul className="divide-y divide-ivory-200 text-sm">
          {others.map((f) => (
            <li key={f.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3" data-file={f.kind}>
              <div>
                <a href={`/os/files/${f.id}`} target="_blank" rel="noreferrer" className="font-medium text-navy-700 hover:underline">{f.title}</a>
                <p className="text-xs text-ink-500">{ar ? FILE_KIND[f.kind]?.[0] : FILE_KIND[f.kind]?.[1]} · <span className="num">{f.ref}</span>{f.taken_on ? ` · ${f.taken_on}` : ""} · {dateTime(f.created_at, locale)}</p>
                {f.reviewed_at && <p className={`text-xs ${f.abnormal ? "text-danger" : "text-ok"}`}>{f.abnormal ? (ar ? "غير طبيعي" : "Abnormal") : (ar ? "طبيعي" : "Normal")}{f.review_note ? ` — ${f.review_note}` : ""}</p>}
                {f.released_at && <p className="text-xs text-teal-700">{ar ? "ظاهر للمريض" : "Visible to the patient"}{f.release_note ? ` — ${f.release_note}` : ""}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManage && f.clinical && f.kind !== "photo" && !f.reviewed_at && (
                  <form action={reviewPatientFile} className="flex items-center gap-2" data-review-file><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="patient_id" value={patientId} />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="abnormal" />{ar ? "غير طبيعي" : "Abnormal"}</label>
                    <input name="note" placeholder={ar ? "تعليق الطبيب" : "Doctor's comment"} className="input w-40 py-1 text-xs" />
                    <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "تمت المراجعة" : "Reviewed"}</SubmitButton></form>)}
                {canManage && f.clinical && !f.released_at && (f.kind === "photo" || f.reviewed_at) && (
                  <form action={releasePatientFile} className="flex items-center gap-2" data-release-file><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="patient_id" value={patientId} />
                    <input name="note" placeholder={ar ? "رسالة للمريض (اختياري)" : "Note to the patient (optional)"} className="input w-48 py-1 text-xs" />
                    <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "إظهار للمريض" : "Show to patient"}</SubmitButton></form>)}
                {(f.uploaded_by === userId || canManage) && (
                  <details className="text-xs"><summary className="cursor-pointer text-ink-500">{ar ? "إلغاء" : "Void"}</summary>
                    <form action={voidPatientFile} className="mt-1 flex gap-1"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="patient_id" value={patientId} />
                      <input name="reason" required placeholder={ar ? "السبب" : "Reason"} className="input w-32 py-1 text-xs" />
                      <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs text-danger">{ar ? "تأكيد" : "Confirm"}</SubmitButton></form></details>)}
              </div>
            </li>))}
        </ul>)}
      {photos.length > 0 && (
        <div className="space-y-4 border-t border-ivory-200 p-5" data-photo-gallery>
          {areas.map((area) => {
            const list = photos.filter((p) => (p.body_area ?? (ar ? "بدون منطقة" : "No area")) === area)
              .sort((a, b) => (a.taken_on ?? a.created_at).localeCompare(b.taken_on ?? b.created_at));
            return (
              <div key={area}>
                <p className="mb-2 text-sm font-medium text-navy-700">{area}</p>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {list.map((p) => (
                    <figure key={p.id} className="w-40 shrink-0">
                      <a href={`/os/files/${p.id}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/os/files/${p.id}`} alt={p.title} className="h-32 w-40 rounded-lg border border-ivory-200 object-cover" loading="lazy" /></a>
                      <figcaption className="mt-1 text-xs text-ink-500">{p.photo_stage ? (ar ? STAGE[p.photo_stage][0] : STAGE[p.photo_stage][1]) : ""} · {p.taken_on ?? dateTime(p.created_at, locale, { timeStyle: undefined })}
                        {p.released_at ? <span className="text-teal-700"> · {ar ? "ظاهرة للمريض" : "shared"}</span> : canManage ? (
                          <form action={releasePatientFile} className="inline"><input type="hidden" name="file_id" value={p.id} /><input type="hidden" name="patient_id" value={patientId} />
                            <button className="ms-1 text-teal-700 hover:underline">{ar ? "مشاركة" : "share"}</button></form>) : null}</figcaption>
                    </figure>))}
                </div>
              </div>);
          })}
        </div>)}
      {files.length === 0 && <p className="px-5 py-4 text-sm text-ink-300">{ar ? "لا توجد ملفات." : "No files."}</p>}
      {canUpload && (
        <form key={randomUUID()} action={uploadPatientFile} className="grid gap-3 border-t border-ivory-200 p-5 text-sm md:grid-cols-6" data-upload-file>
          <input type="hidden" name="patient_id" value={patientId} />
          <label className="md:col-span-2"><span className="label">{ar ? "الملف (PDF أو صورة حتى 15 ميجا)" : "File (PDF or photo, up to 15 MB)"}</span>
            <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" className="input py-1.5" /></label>
          <label><span className="label">{ar ? "النوع" : "Type"}</span>
            <select name="kind" className="input">{Object.entries(FILE_KIND).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select></label>
          <label className="md:col-span-2"><span className="label">{ar ? "العنوان" : "Title"}</span><input name="title" required placeholder={ar ? "مثال: صورة دم كاملة — معمل…" : "e.g. CBC — lab name"} className="input" /></label>
          <label><span className="label">{ar ? "التاريخ" : "Date"}</span><input name="taken_on" type="date" className="input" /></label>
          {appointments.length > 0 && <label className="md:col-span-2"><span className="label">{ar ? "الزيارة" : "Visit"}</span>
            <select name="appointment_id" className="input"><option value="">—</option>{appointments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}
          <label><span className="label">{ar ? "مرحلة الصورة" : "Photo stage"}</span>
            <select name="photo_stage" className="input"><option value="">—</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select></label>
          <label className="md:col-span-2"><span className="label">{ar ? "المنطقة (للصور)" : "Area (photos)"}</span><input name="body_area" placeholder={ar ? "مثال: الوجه، الإبط" : "e.g. face, underarm"} className="input" /></label>
          <div className="flex items-end"><SubmitButton pendingLabel="…">{ar ? "رفع" : "Upload"}</SubmitButton></div>
        </form>)}
    </section>
  );
}
