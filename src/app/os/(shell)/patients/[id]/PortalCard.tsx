import type { Ctx } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { grantFamily, revokeFamily } from "@/app/actions/support";
import { SubmitButton } from "@/components/SubmitButton";

export const RELATIONS: Record<string, [string, string]> = {
  parent: ["ولي أمر / والد", "Parent"], child: ["ابن / ابنة", "Child"], spouse: ["زوج / زوجة", "Spouse"],
  guardian: ["وصي قانوني", "Legal guardian"], caregiver: ["مرافق / مقدم رعاية", "Caregiver"], other: ["أخرى", "Other"],
};

type Grant = { id: string; level: string; relation: string; granted_via: string; expires_at: string | null; evidence: string | null; created_at: string;
  grantee_patient_id: string; patient_id: string };

// Patient account status and family / guardian access for one patient file.
export async function PortalCard({ ctx, patientId }: { ctx: Ctx; patientId: string }) {
  const ar = ctx.locale === "ar";
  const [{ data: account }, { data: grants }] = await Promise.all([
    ctx.supabase.from("patient_accounts").select("created_at, last_login_at, is_active").eq("patient_id", patientId).maybeSingle(),
    ctx.supabase.from("family_access_grants").select("id, level, relation, granted_via, expires_at, evidence, created_at, grantee_patient_id, patient_id")
      .eq("patient_id", patientId).is("revoked_at", null).order("created_at", { ascending: false }).returns<Grant[]>(),
  ]);
  const active = (grants ?? []).filter((g) => !g.expires_at || new Date(g.expires_at).getTime() > Date.now());
  const { data: dir } = active.length ? await ctx.supabase.rpc("patient_directory", { p_ids: active.map((g) => g.grantee_patient_id) }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; mrn: string; full_name_ar: string }[]).map((p) => [p.id, p]));
  const canWrite = ctx.can("patient.write");

  return (
    <section className="card p-5 lg:col-span-3">
      <h2 className="mb-1 font-medium text-navy-700">{ar ? "حساب المريض والوصول العائلي" : "Patient account & family access"}</h2>
      <p className="mb-4 text-sm text-ink-500">
        {account
          ? <>{ar ? "للمريض حساب على البوابة" : "Has a portal account"} · {ar ? "آخر دخول" : "last sign-in"} {account.last_login_at ? dateTime(account.last_login_at, ctx.locale) : "—"}</>
          : ar ? "لم يسجل المريض الدخول إلى حسابه بعد. يدخل برقم موبايله المسجل ورمز يصله على واتساب." : "The patient has not signed in yet. They sign in with their registered mobile and a WhatsApp code."}
      </p>

      <h3 className="mb-2 text-sm font-medium">{ar ? "من يستطيع رؤية هذا الملف" : "Who can view this file"}</h3>
      {active.length === 0 ? <p className="mb-4 text-sm text-ink-300">{ar ? "لا أحد غير المريض." : "Only the patient."}</p> : (
        <ul className="mb-4 divide-y divide-ivory-200 rounded-lg border border-ivory-200 text-sm">
          {active.map((g) => {
            const who = names.get(g.grantee_patient_id);
            return (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-medium">{who?.full_name_ar ?? "—"}</span> <span className="num text-xs text-ink-300">{who?.mrn}</span>
                  <span className="block text-xs text-ink-500">
                    {ar ? RELATIONS[g.relation]?.[0] : RELATIONS[g.relation]?.[1]} · {g.level === "full" ? (ar ? "الملف كامل" : "Full file") : (ar ? "المواعيد فقط" : "Appointments only")}
                    {" · "}{g.granted_via === "staff" ? (ar ? "بواسطة العيادة" : "by the clinic") : (ar ? "بواسطة المريض" : "by the patient")}
                    {g.expires_at ? ` · ${ar ? "حتى" : "until"} ${dateTime(g.expires_at, ctx.locale, { timeStyle: undefined })}` : ""}
                    {g.evidence ? ` · ${g.evidence}` : ""}
                  </span>
                </span>
                {canWrite && (
                  <form action={revokeFamily}>
                    <input type="hidden" name="patient_id" value={patientId} /><input type="hidden" name="grant_id" value={g.id} />
                    <SubmitButton pendingLabel="…" className="btn-danger text-xs">{ar ? "إلغاء الوصول" : "Revoke"}</SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <form action={grantFamily} className="grid gap-3 rounded-lg bg-ivory-50 p-4 sm:grid-cols-6">
          <input type="hidden" name="patient_id" value={patientId} />
          <p className="text-xs text-ink-500 sm:col-span-6">{ar ? "لولي أمر طفل أو مرافق مريض: يجب أن يكون للشخص ملف لدينا. سجّل مستند الإثبات (شهادة ميلاد، توكيل، قرار وصاية)." : "For a child's parent or a patient's caregiver: the person needs their own file. Record the evidence (birth certificate, power of attorney, guardianship order)."}</p>
          <div className="sm:col-span-1"><label className="label">{ar ? "رقم ملف الشخص" : "Person's MRN"}</label><input name="grantee_mrn" required className="input" dir="ltr" /></div>
          <div className="sm:col-span-1"><label className="label">{ar ? "الصلة" : "Relation"}</label>
            <select name="relation" className="input">{Object.entries(RELATIONS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select></div>
          <div className="sm:col-span-1"><label className="label">{ar ? "المستوى" : "Level"}</label>
            <select name="level" className="input"><option value="appointments">{ar ? "المواعيد فقط" : "Appointments only"}</option><option value="full">{ar ? "الملف كامل" : "Full file"}</option></select></div>
          <div className="sm:col-span-1"><label className="label">{ar ? "المدة (يوم)" : "Days"}</label><input name="days" type="number" min={1} max={730} defaultValue={365} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">{ar ? "مستند الإثبات" : "Evidence"}</label><input name="evidence" required className="input" /></div>
          <div className="sm:col-span-6"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "منح الوصول" : "Grant access"}</SubmitButton></div>
        </form>
      )}
    </section>
  );
}
