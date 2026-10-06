import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PLAN_STATUS, label } from "@/lib/dental";
import { PageHeader } from "@/components/PageHeader";
import { Stat } from "@/components/Stat";

export const dynamic = "force-dynamic";

type Row = { id: string; ref: string; patient_id: string; title: string; status: string; total: number; quote_no: string | null; valid_until: string | null; created_at: string;
  doctor: { full_name_ar: string; full_name_en: string | null } | null };
type Over = { plan_id: string; plan_ref: string; patient_id: string; seq: number; due_on: string; amount: number; paid_amount: number; days_late: number };

const TABS: { key: string; statuses: string[] }[] = [
  { key: "proposed", statuses: ["proposed"] }, { key: "active", statuses: ["accepted", "in_progress"] }, { key: "draft", statuses: ["draft"] },
  { key: "completed", statuses: ["completed"] }, { key: "cancelled", statuses: ["cancelled"] },
];

export default async function PlansPage({ searchParams }: { searchParams: { tab?: string } }) {
  const ctx = await requireAny("plan.write", "plan.accept", "billing.read");
  const ar = ctx.locale === "ar";
  const tab = TABS.find((t) => t.key === searchParams.tab) ?? TABS[0];
  const [{ data: rows }, { data: over }, { data: counts }] = await Promise.all([
    ctx.supabase.from("treatment_plans").select("id, ref, patient_id, title, status, total, quote_no, valid_until, created_at, doctor:staff(full_name_ar, full_name_en)")
      .in("status", tab.statuses).order("created_at", { ascending: false }).limit(100).returns<Row[]>(),
    ctx.supabase.rpc("overdue_installments", { p_branch: null }),
    ctx.supabase.from("treatment_plans").select("status, total"),
  ]);
  const overdue = (over ?? []) as Over[];
  const ids = Array.from(new Set([...(rows ?? []).map((r) => r.patient_id), ...overdue.map((o) => o.patient_id)]));
  const { data: dir } = ids.length ? await ctx.supabase.rpc("patient_directory", { p_ids: ids }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; full_name_ar: string; phone: string | null }[]).map((p) => [p.id, p]));
  const c = (st: string[]) => (counts ?? []).filter((x: { status: string }) => st.includes(x.status));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const tabName = (k: string) => ({ proposed: ar ? "عروض بانتظار الموافقة" : "Awaiting acceptance", active: ar ? "قيد التنفيذ" : "In progress", draft: ar ? "مسودات" : "Drafts",
    completed: ar ? "مكتملة" : "Completed", cancelled: ar ? "ملغاة" : "Cancelled" }[k] ?? k);

  return (
    <>
      <PageHeader title={ar ? "خطط العلاج والأقساط" : "Treatment plans & installments"}
        subtitle={ar ? "الطبيب يعد الخطة وعرض السعر، الاستقبال يسجل موافقة المريض وجدول الأقساط، ويُفوتر ما يُنفّذ أولًا بأول." : "Doctors prepare plans and quotations; front desk records acceptance and installments; work is billed as it is done."} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "عروض بانتظار الموافقة" : "Quotations pending"} value={c(["proposed"]).length} tone="gold" />
        <Stat label={ar ? "خطط قيد التنفيذ" : "Plans in progress"} value={c(["accepted", "in_progress"]).length} tone="teal" />
        <Stat label={ar ? "قيمة الخطط الجارية" : "Value of active plans"} value={money(c(["accepted", "in_progress"]).reduce((a: number, x: { total: number }) => a + Number(x.total), 0), ctx.locale)} />
        <Stat label={ar ? "أقساط متأخرة" : "Overdue installments"} value={overdue.length} tone={overdue.length ? "danger" : "navy"} />
      </div>
      {overdue.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-medium text-danger">{ar ? "أقساط متأخرة — للمتابعة مع المريض" : "Overdue installments — follow up with the patient"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">
            {overdue.map((o) => (
              <li key={`${o.plan_id}-${o.seq}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <Link href={`/os/plans/${o.plan_id}`} className="text-navy-700 hover:underline">{names.get(o.patient_id)?.full_name_ar ?? ""} · <span className="num">{o.plan_ref}</span> · {ar ? "قسط" : "installment"} {o.seq}</Link>
                <span><span className="num font-medium">{money(Number(o.amount) - Number(o.paid_amount), ctx.locale)}</span> <span className="text-xs text-danger">{o.days_late} {ar ? "يوم تأخير" : "days late"}</span></span>
              </li>))}
          </ul>
        </section>
      )}
      <nav className="mb-3 flex flex-wrap gap-2 text-sm">
        {TABS.map((t) => <Link key={t.key} href={`/os/plans?tab=${t.key}`} className={`rounded-full px-3 py-1 ${t.key === tab.key ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50"}`}>{tabName(t.key)}</Link>)}
      </nav>
      <ul className="card divide-y divide-ivory-200 text-sm">
        {(rows ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <Link href={`/os/plans/${r.id}`} className="text-navy-700 hover:underline"><span className="font-medium">{names.get(r.patient_id)?.full_name_ar ?? ""}</span> · {r.title}
              <span className="block text-xs text-ink-300"><span className="num">{r.ref}{r.quote_no ? ` · ${r.quote_no}` : ""}</span> · {r.doctor ? (ar ? r.doctor.full_name_ar : r.doctor.full_name_en ?? r.doctor.full_name_ar) : ""}</span></Link>
            <span className="text-end"><span className="num font-medium">{money(r.total, ctx.locale)}</span>
              <span className={`block text-xs ${r.status === "proposed" && r.valid_until && r.valid_until < today ? "text-danger" : "text-ink-500"}`}>{label(PLAN_STATUS, r.status, ar)}{r.status === "proposed" && r.valid_until ? ` · ${ar ? "حتى" : "until"} ${r.valid_until}` : ""}</span></span>
          </li>))}
      </ul>
    </>
  );
}
