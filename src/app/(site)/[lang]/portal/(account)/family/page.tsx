import { redirect } from "next/navigation";
import { getPortal, cardName, RELATION } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime } from "@/lib/format";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { portalRevoke, portalShare, switchPatient } from "@/app/actions/portal";

export default async function PortalFamily({ params, searchParams }: { params: { lang: Lang }; searchParams: { ok?: string; error?: string } }) {
  const { me, isSelf, ar, lang } = await getPortal(params.lang);
  if (!isSelf) redirect(`/${lang}/portal/home`);
  const lvl = (l: string) => (l === "full" ? (ar ? "الملف كامل" : "Full file") : (ar ? "المواعيد فقط" : "Appointments only"));
  const until = (d: string | null) => (d ? `${ar ? "حتى" : "until"} ${dateTime(d, lang, { dateStyle: "medium", timeStyle: undefined })}` : "");
  const ok = searchParams.ok === "shared" ? (ar ? "تمت المشاركة." : "Access shared.") : searchParams.ok === "revoked" ? (ar ? "تم إلغاء المشاركة." : "Access revoked.") : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "العائلة والمشاركة" : "Family & sharing"}</h1>
      <Banner error={searchParams.error} success={ok} />

      <section className="rounded-2xl border border-ivory-300/70 bg-white p-5">
        <h2 className="mb-1 font-medium text-navy-700">{ar ? "ملفات يمكنك متابعتها" : "Files you can follow"}</h2>
        <p className="mb-3 text-xs text-ink-500">{ar ? "لإضافة ملف طفلك أو شخص ترعاه، يسجّل فريق الاستقبال ذلك بعد الاطلاع على مستند الإثبات." : "To add your child's file or someone you care for, reception records it after checking the supporting document."}</p>
        {me.family.length === 0 ? <p className="text-sm text-ink-300">{ar ? "لا توجد ملفات." : "None."}</p> : (
          <ul className="divide-y divide-ivory-200">
            {me.family.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span><span className="font-medium">{cardName(f, lang)}</span> <span className="num text-xs text-ink-300">{f.mrn}</span>
                  <span className="block text-xs text-ink-500">{lvl(f.level)} {until(f.expires_at)}</span></span>
                <form action={switchPatient}><input type="hidden" name="lang" value={lang} /><input type="hidden" name="patient" value={f.id} />
                  <SubmitButton pendingLabel="…" className="btn-ghost text-sm">{ar ? "فتح الملف" : "Open file"}</SubmitButton></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-ivory-300/70 bg-white p-5">
        <h2 className="mb-1 font-medium text-navy-700">{ar ? "من يستطيع رؤية ملفي" : "Who can see my file"}</h2>
        {me.shared_with.length === 0 ? <p className="mb-4 text-sm text-ink-300">{ar ? "أنت فقط." : "Only you."}</p> : (
          <ul className="mb-4 divide-y divide-ivory-200">
            {me.shared_with.map((g) => (
              <li key={g.grant_id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span><span className="font-medium">{g.name}</span>
                  <span className="block text-xs text-ink-500">{ar ? RELATION[g.relation]?.[0] : RELATION[g.relation]?.[1]} · {lvl(g.level)} {until(g.expires_at)}</span></span>
                <form action={portalRevoke}><input type="hidden" name="lang" value={lang} /><input type="hidden" name="grant" value={g.grant_id} />
                  <SubmitButton pendingLabel="…" className="btn-danger text-xs">{ar ? "إلغاء" : "Revoke"}</SubmitButton></form>
              </li>
            ))}
          </ul>
        )}
        <form action={portalShare} className="grid gap-3 rounded-xl bg-ivory-50 p-4 sm:grid-cols-2">
          <input type="hidden" name="lang" value={lang} />
          <p className="text-xs text-ink-500 sm:col-span-2">{ar ? "شارك ملفك مع فرد من العائلة له ملف لدينا. اكتب رقم ملفه ورقم موبايله المسجل (للتأكد من هويته)." : "Share your file with a family member who has a file with us. Enter their file number and registered mobile (to confirm who they are)."}</p>
          <div><label className="label" htmlFor="mrn">{ar ? "رقم ملفه" : "Their file number"}</label><input id="mrn" name="mrn" required dir="ltr" className="input" /></div>
          <div><label className="label" htmlFor="sphone">{ar ? "رقم موبايله" : "Their mobile"}</label><input id="sphone" name="phone" type="tel" required dir="ltr" className="input" /></div>
          <div><label className="label" htmlFor="relation">{ar ? "صلته بك" : "Relation to you"}</label>
            <select id="relation" name="relation" className="input">{["spouse", "child", "parent", "caregiver", "other"].map((k) => <option key={k} value={k}>{ar ? RELATION[k][0] : RELATION[k][1]}</option>)}</select></div>
          <div><label className="label" htmlFor="level">{ar ? "ماذا يرى" : "What they see"}</label>
            <select id="level" name="level" className="input"><option value="appointments">{lvl("appointments")}</option><option value="full">{ar ? "الملف كامل (الروشتات والفواتير)" : "Full file (prescriptions and invoices)"}</option></select></div>
          <div><label className="label" htmlFor="days">{ar ? "لمدة (يوم)" : "For (days)"}</label><input id="days" name="days" type="number" min={1} max={730} defaultValue={365} className="input" /></div>
          <div className="flex items-end"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "مشاركة" : "Share"}</SubmitButton></div>
        </form>
      </section>
    </div>
  );
}
