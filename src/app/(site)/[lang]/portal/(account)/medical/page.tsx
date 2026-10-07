import Link from "next/link";
import { redirect } from "next/navigation";
import { getPortal, type PortalMedical } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime } from "@/lib/format";

export default async function PortalMedicalPage({ params }: { params: { lang: Lang } }) {
  const { supabase, active, full, ar, lang } = await getPortal(params.lang);
  if (!full) redirect(`/${lang}/portal/home`);
  const { data } = await supabase.rpc("portal_medical", { p_patient: active.id });
  const m = (data ?? { visits: [], prescriptions: [], allergies: [] }) as PortalMedical;
  const day = (iso: string) => dateTime(iso, lang, { dateStyle: "long", timeStyle: undefined });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-navy-700">{ar ? "الزيارات والروشتات" : "Visits & prescriptions"}</h1>
        <p className="mt-1 text-sm text-ink-500">{ar ? "يظهر هنا ما راجعه طبيبك وأفرج عنه لك. لأي استفسار طبي تواصل مع العيادة — هذه الصفحة ليست بديلًا عن استشارة الطبيب." : "This shows what your doctor reviewed and released to you. For medical questions contact the clinic — this page does not replace a consultation."}</p>
      </div>
      {m.allergies.length > 0 && <p className="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger">{ar ? "حساسية مسجلة:" : "Recorded allergy:"} {m.allergies.join(ar ? "، " : ", ")}</p>}

      {(m.files ?? []).length > 0 && (
        <section data-portal-files>
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "النتائج والتقارير والصور" : "Results, reports and photos"}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(m.files ?? []).map((f) => (
              <li key={f.id} className="rounded-2xl border border-ivory-300/70 bg-white p-4">
                <a href={`/${lang}/portal/files/${f.id}`} target="_blank" rel="noreferrer" className="font-medium text-navy-700 hover:underline">{f.title}</a>
                <p className="text-xs text-ink-500">{({ lab_result: ar ? "نتيجة تحليل" : "Lab result", radiology: ar ? "أشعة" : "Radiology", medical_report: ar ? "تقرير طبي" : "Medical report", photo: ar ? "صورة" : "Photo" } as Record<string, string>)[f.kind] ?? f.kind}
                  {f.taken_on ? ` · ${f.taken_on}` : ""}{f.body_area ? ` · ${f.body_area}` : ""}</p>
                {f.note && <p className="mt-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">{ar ? "رسالة الطبيب: " : "From your doctor: "}{f.note}</p>}
              </li>))}
          </ul>
        </section>)}

      <section>
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "الروشتات" : "Prescriptions"}</h2>
        {m.prescriptions.length === 0 ? <Empty ar={ar} /> : (
          <ul className="space-y-3">
            {m.prescriptions.map((r) => (
              <li key={r.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-navy-700">{day(r.date)}</p>
                    <p className="text-sm text-ink-500">{ar ? r.doctor_ar : r.doctor_en} · <span className="num text-xs">{r.ref}</span></p>
                  </div>
                  <Link href={`/${lang}/portal/medical/rx/${r.id}`} className="btn-ghost text-sm">{ar ? "عرض وطباعة" : "View & print"}</Link>
                </div>
                <ol className="space-y-2 text-sm">
                  {r.items.map((i, n) => (
                    <li key={n} className="rounded-lg bg-ivory-50 px-3 py-2">
                      <span className="font-medium" dir="ltr">{i.drug} {[i.strength, i.form].filter(Boolean).join(" ")}</span>
                      <span className="block text-ink-500">{i.dose} — {i.frequency}{i.duration ? ` — ${i.duration}` : ""}</span>
                      {i.instructions && <span className="block text-xs text-ink-500">{i.instructions}</span>}
                    </li>
                  ))}
                </ol>
                {r.notes && <p className="mt-3 text-sm text-ink-500">{r.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "ملخصات الزيارات" : "Visit summaries"}</h2>
        {m.visits.length === 0 ? <Empty ar={ar} /> : (
          <ul className="space-y-3">
            {m.visits.map((v) => (
              <li key={v.id} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
                <p className="font-medium text-navy-700">{day(v.date)}</p>
                <p className="mb-3 text-sm text-ink-500">{ar ? v.doctor_ar : v.doctor_en} · {ar ? v.specialty_ar : v.specialty_en}</p>
                <p className="whitespace-pre-wrap text-sm leading-7">{v.summary}</p>
                {v.instructions && (
                  <div className="mt-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900">
                    <p className="mb-1 text-xs font-medium">{ar ? "تعليمات المتابعة" : "Follow-up instructions"}</p>
                    <p className="whitespace-pre-wrap">{v.instructions}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Empty({ ar }: { ar: boolean }) {
  return <p className="rounded-2xl border border-ivory-300/70 bg-white p-6 text-sm text-ink-500">{ar ? "لا يوجد شيء بعد." : "Nothing yet."}</p>;
}
