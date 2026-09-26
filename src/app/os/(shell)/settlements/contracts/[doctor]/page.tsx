import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { saveContract } from "@/app/actions/settlements";

export const dynamic = "force-dynamic";

type Contract = { id: string; valid: string; default_percent: number; notes: string | null; created_at: string;
  rates: { service_id: string; percent: number | null; fixed_amount: number | null }[] };

export default async function ContractsPage({ params, searchParams }: { params: { doctor: string }; searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("contract.manage");
  const ar = ctx.locale === "ar";
  const { data: doc } = await ctx.supabase.from("staff").select("id, full_name_ar, full_name_en, specialty_id").eq("id", params.doctor).eq("kind", "doctor").maybeSingle();
  if (!doc) notFound();
  const [{ data: contracts }, { data: services }] = await Promise.all([
    ctx.supabase.from("doctor_contracts").select("id, valid, default_percent, notes, created_at, rates:doctor_contract_rates(service_id, percent, fixed_amount)")
      .eq("doctor_id", doc.id).order("valid", { ascending: false }).returns<Contract[]>(),
    ctx.supabase.from("services").select("id, code, name_ar, name_en, specialty_id").eq("is_active", true).order("code"),
  ]);
  const svc = new Map((services ?? []).map((s) => [s.id, s]));
  const current = (contracts ?? [])[0];
  const range = (v: string) => { const [lo, hi] = v.replace(/[[()\]]/g, "").split(","); return `${lo} → ${hi || (ar ? "مفتوح" : "open")}`; };
  const own = (services ?? []).filter((s) => s.specialty_id === doc.specialty_id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

  return (
    <>
      <PageHeader title={`${ar ? "عقود" : "Contracts"} — ${ar ? doc.full_name_ar : doc.full_name_en ?? doc.full_name_ar}`}
        subtitle={ar ? "العقد لا يُعدّل بأثر رجعي بعد استخدامه في كشف معتمد: لتغييره ابدأ عقدًا جديدًا من تاريخ لاحق وسينتهي القديم تلقائيًا." : "A contract used in an approved statement is never changed retroactively: start a new one from a later date and the old one ends automatically."}
        actions={<Link href="/os/settlements" className="btn-ghost">{ctx.t("common.back")}</Link>} />
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? "تم حفظ العقد وتسجيله في سجل التدقيق." : "Contract saved and audited.") : undefined} />
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="card p-5 lg:col-span-3">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "عقد جديد" : "New contract"}</h2>
          <form action={saveContract} className="space-y-4">
            <input type="hidden" name="doctor_id" value={doc.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="from">{ar ? "يبدأ من" : "Starts on"}</label><input id="from" name="from" type="date" required defaultValue={today} className="input" /></div>
              <div><label className="label" htmlFor="dp">{ar ? "النسبة الأساسية من صافي الخدمة (%)" : "Default share of net service (%)"}</label>
                <input id="dp" name="default_percent" type="number" min={0} max={100} step="0.01" required defaultValue={current ? Number(current.default_percent) : undefined} className="input num" /></div>
            </div>
            <div>
              <p className="label">{ar ? "استثناءات لخدمات محددة (اتركها فارغة لتطبيق النسبة الأساسية)" : "Service-specific terms (leave empty to use the default share)"}</p>
              <div className="divide-y divide-ivory-200 rounded-lg border border-ivory-200">
                {own.map((s) => {
                  const r = current?.rates.find((x) => x.service_id === s.id);
                  return (
                    <div key={s.id} className="grid grid-cols-5 items-center gap-2 px-3 py-2 text-sm">
                      <span className="col-span-2">{ar ? s.name_ar : s.name_en} <span className="num text-xs text-ink-300">{s.code}</span></span>
                      <select name={`kind_${s.id}`} defaultValue={r?.fixed_amount != null ? "fixed" : "percent"} className="input col-span-2 py-1" aria-label={ar ? "نوع" : "Kind"}>
                        <option value="percent">{ar ? "نسبة %" : "Percent %"}</option><option value="fixed">{ar ? "مبلغ ثابت للوحدة" : "Fixed per unit"}</option>
                      </select>
                      <input name={`rate_${s.id}`} type="number" min={0} step="0.01" defaultValue={r ? Number(r.fixed_amount ?? r.percent) : undefined} className="input num py-1" aria-label={ar ? "القيمة" : "Value"} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div><label className="label" htmlFor="notes">{ar ? "ملاحظات / مرجع العقد الورقي" : "Notes / signed contract reference"}</label><input id="notes" name="notes" className="input" /></div>
            <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "حفظ العقد" : "Save contract"}</SubmitButton>
          </form>
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "سجل العقود" : "Contract history"}</h2>
          {(contracts ?? []).length === 0 ? <p className="text-sm text-ink-300">{ar ? "لا يوجد عقد. لن يُعتمد أي كشف لهذا الطبيب قبل إضافة عقد." : "No contract. No statement can be approved for this doctor until one is added."}</p> : (
            <ul className="space-y-3 text-sm">
              {(contracts ?? []).map((c) => (
                <li key={c.id} className="rounded-lg bg-ivory-50 p-3">
                  <p className="num font-medium">{range(c.valid)} · {Number(c.default_percent)}%</p>
                  {c.rates.map((r) => { const s = svc.get(r.service_id); return <p key={r.service_id} className="text-xs text-ink-500">{ar ? s?.name_ar : s?.name_en}: <span className="num">{r.fixed_amount != null ? money(r.fixed_amount, ctx.locale) : `${Number(r.percent)}%`}</span></p>; })}
                  {c.notes && <p className="text-xs text-ink-300">{c.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
