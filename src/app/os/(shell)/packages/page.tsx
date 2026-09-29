import Link from "next/link";
import { requireAny } from "@/lib/session";
import { money } from "@/lib/format";
import { PACKAGE_STATUS, label } from "@/lib/devices";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { expirePackages, savePackageTemplate } from "@/app/actions/packages";

export const dynamic = "force-dynamic";

type Tpl = { id: string; code: string; name_ar: string; name_en: string; sessions: number; price: number; validity_days: number; is_active: boolean; branch_id: string | null; service_id: string;
  service: { code: string; name_ar: string; name_en: string } | null };
type Pkg = { id: string; ref: string; patient_id: string; units_total: number; units_used: number; value_total: number; value_used: number; expires_on: string; status: string;
  invoice_id: string; template: { name_ar: string; name_en: string } | null };

export default async function PackagesPage({ searchParams }: { searchParams: { error?: string; ok?: string; status?: string } }) {
  const ctx = await requireAny("package.read", "package.manage", "package.sell");
  const ar = ctx.locale === "ar";
  const status = searchParams.status ?? "active";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const [{ data: tpls }, { data: pkgs }, { data: services }, { data: branches }] = await Promise.all([
    ctx.supabase.from("package_templates").select("id, code, name_ar, name_en, sessions, price, validity_days, is_active, branch_id, service_id, service:services!package_templates_service_id_fkey(code, name_ar, name_en)")
      .order("is_active", { ascending: false }).order("code").returns<Tpl[]>(),
    ctx.supabase.from("patient_packages").select("id, ref, patient_id, units_total, units_used, value_total, value_used, expires_on, status, invoice_id, template:package_templates(name_ar, name_en)")
      .eq("status", status).order("sold_at", { ascending: false }).limit(100).returns<Pkg[]>(),
    ctx.can("package.manage") ? ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("is_package", false).eq("is_active", true).order("code") : Promise.resolve({ data: [] }),
    ctx.can("package.manage") ? ctx.supabase.from("branches").select("id, name_ar, name_en").eq("is_active", true).order("code") : Promise.resolve({ data: [] }),
  ]);
  const list = pkgs ?? [];
  const { data: dir } = list.length ? await ctx.supabase.rpc("patient_directory", { p_ids: Array.from(new Set(list.map((p) => p.patient_id))) }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; full_name_ar: string }[]).map((p) => [p.id, p.full_name_ar]));
  const deferred = status === "active" ? list.reduce((a, p) => a + Number(p.value_total) - Number(p.value_used), 0) : null;
  const overdue = status === "active" ? list.filter((p) => p.expires_on < today).length : 0;
  const [okKind, okN] = (searchParams.ok ?? "").split(":");
  const ok = { created: ar ? "تم إنشاء الباقة." : "Package created.", updated: ar ? "تم تحديث الباقة (يسري على المبيعات الجديدة فقط)." : "Package updated (applies to new sales only).",
    expired: ar ? `تم إنهاء ${okN} باقة وترحيل الرصيد غير المستخدم.` : `${okN} package(s) expired; unused balance posted.` }[okKind];

  return (
    <>
      <PageHeader title={ar ? "الباقات" : "Packages"}
        subtitle={ar ? "تُباع الباقة بفاتورة ويُسجل ثمنها كإيراد مؤجل، ويتحول لإيراد مع كل جلسة تُستخدم. تُباع من ملف المريض." : "A package is sold on an invoice as deferred revenue and recognised as each session is used. Sell it from the patient file."} />
      <Banner error={searchParams.error} success={ok} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "باقات سارية" : "Active packages"} value={status === "active" ? list.length : "—"} />
        <Stat label={ar ? "رصيد مؤجل (سارية)" : "Deferred balance (active)"} value={deferred !== null ? money(deferred, ctx.locale) : "—"} tone="gold" />
        <Stat label={ar ? "تجاوزت الصلاحية" : "Past validity"} value={overdue} tone={overdue ? "danger" : "teal"} />
        <Stat label={ar ? "باقات معروضة للبيع" : "Packages on sale"} value={(tpls ?? []).filter((t) => t.is_active).length} tone="teal" />
      </div>
      {ctx.can("package.expire") && overdue > 0 && (
        <form action={expirePackages} className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warn/30 bg-warn-50 p-4 text-sm">
          <span>{ar ? `${overdue} باقة تجاوزت صلاحيتها. الإنهاء يرحّل الرصيد غير المستخدم إلى إيراد الباقات المنتهية (4130).` : `${overdue} package(s) are past validity. Expiring posts the unused balance to expired-package revenue (4130).`}</span>
          <SubmitButton pendingLabel="…" className="btn-danger text-sm">{ar ? "إنهاء الباقات المنتهية" : "Expire packages"}</SubmitButton>
        </form>
      )}

      <section className="mb-8">
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "الباقات المعروضة" : "Package catalogue"}</h2>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
              <th className="th">{ar ? "الباقة" : "Package"}</th><th className="th">{ar ? "الخدمة" : "Service"}</th><th className="th">{ar ? "الجلسات" : "Sessions"}</th>
              <th className="th">{ar ? "السعر" : "Price"}</th><th className="th">{ar ? "سعر الجلسة" : "Per session"}</th><th className="th">{ar ? "الصلاحية" : "Validity"}</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-ivory-200">
              {(tpls ?? []).length === 0 && <tr><td className="td text-ink-300" colSpan={7}>{ctx.t("common.none")}</td></tr>}
              {(tpls ?? []).map((t) => (
                <tr key={t.id} className={t.is_active ? "" : "opacity-50"}>
                  <td className="td font-medium">{ar ? t.name_ar : t.name_en}<span className="block text-xs text-ink-300 num">{t.code}</span></td>
                  <td className="td">{t.service ? (ar ? t.service.name_ar : t.service.name_en) : ""}</td>
                  <td className="td num">{t.sessions}</td><td className="td num">{money(t.price, ctx.locale)}</td>
                  <td className="td num">{money(Number(t.price) / t.sessions, ctx.locale)}</td><td className="td">{t.validity_days} {ar ? "يوم" : "days"}</td>
                  <td className="td">{ctx.can("package.manage") && (
                    <form action={savePackageTemplate}>
                      {Object.entries({ id: t.id, code: t.code, name_ar: t.name_ar, name_en: t.name_en, sessions: t.sessions, price: t.price, validity_days: t.validity_days, branch_id: t.branch_id ?? "" })
                        .map(([k, v]) => <input key={k} type="hidden" name={k} value={String(v)} />)}
                      <input type="hidden" name="service_id" value={t.service_id} />
                      <input type="hidden" name="is_active" value={t.is_active ? "off" : "on"} />
                      <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{t.is_active ? (ar ? "إيقاف البيع" : "Stop selling") : (ar ? "إعادة البيع" : "Resume")}</SubmitButton>
                    </form>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ctx.can("package.manage") && (
          <form action={savePackageTemplate} className="card mt-3 grid gap-3 p-4 md:grid-cols-4">
            <div><label className="label" htmlFor="t_code">{ar ? "الكود *" : "Code *"}</label><input id="t_code" name="code" required className="input" dir="ltr" /></div>
            <div><label className="label" htmlFor="t_name_ar">{ar ? "الاسم بالعربية *" : "Arabic name *"}</label><input id="t_name_ar" name="name_ar" required className="input" /></div>
            <div><label className="label" htmlFor="t_name_en">{ar ? "الاسم بالإنجليزية" : "English name"}</label><input id="t_name_en" name="name_en" className="input" dir="ltr" /></div>
            <div><label className="label" htmlFor="t_service">{ar ? "الخدمة التي تُستخدم بها *" : "Service it redeems *"}</label>
              <select id="t_service" name="service_id" required className="input">{(services ?? []).map((x: { id: string; code: string; name_ar: string; name_en: string }) => <option key={x.id} value={x.id}>{x.code} — {ar ? x.name_ar : x.name_en}</option>)}</select></div>
            <div><label className="label" htmlFor="t_sessions">{ar ? "عدد الجلسات *" : "Sessions *"}</label><input id="t_sessions" name="sessions" type="number" min="1" max="100" required className="input num" /></div>
            <div><label className="label" htmlFor="t_price">{ar ? "السعر *" : "Price *"}</label><input id="t_price" name="price" type="number" min="1" step="0.01" required className="input num" /></div>
            <div><label className="label" htmlFor="t_validity">{ar ? "الصلاحية بالأيام *" : "Validity (days) *"}</label><input id="t_validity" name="validity_days" type="number" min="1" required defaultValue={365} className="input num" /></div>
            <div><label className="label" htmlFor="t_branch">{ar ? "الفرع" : "Branch"}</label>
              <select id="t_branch" name="branch_id" className="input"><option value="">{ar ? "كل الفروع" : "All branches"}</option>
                {(branches ?? []).map((b: { id: string; name_ar: string; name_en: string }) => <option key={b.id} value={b.id}>{ar ? b.name_ar : b.name_en}</option>)}</select></div>
            <div className="md:col-span-4"><label className="label" htmlFor="t_terms">{ar ? "الشروط (تظهر للمريض)" : "Terms (shown to the patient)"}</label><input id="t_terms" name="terms_ar" className="input" /></div>
            <div className="md:col-span-4"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إضافة باقة" : "Add package"}</SubmitButton></div>
          </form>
        )}
      </section>

      <section>
        <nav className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <h2 className="me-2 font-medium text-navy-700">{ar ? "باقات المرضى" : "Patient packages"}</h2>
          {Object.keys(PACKAGE_STATUS).map((k) => (
            <Link key={k} href={`/os/packages?status=${k}`} className={`rounded-full px-3 py-1 ${k === status ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50"}`}>{label(PACKAGE_STATUS, k, ar)}</Link>))}
        </nav>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
              <th className="th">{ar ? "الباقة" : "Package"}</th><th className="th">{ar ? "المريض" : "Patient"}</th><th className="th">{ar ? "المستخدم" : "Used"}</th>
              <th className="th">{ar ? "القيمة المستخدمة / الكلية" : "Value used / total"}</th><th className="th">{ar ? "تنتهي" : "Expires"}</th></tr></thead>
            <tbody className="divide-y divide-ivory-200">
              {list.length === 0 && <tr><td className="td text-ink-300" colSpan={5}>{ctx.t("common.none")}</td></tr>}
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="td"><span className="num font-medium">{p.ref}</span><span className="block text-xs text-ink-500">{p.template ? (ar ? p.template.name_ar : p.template.name_en) : ""}</span></td>
                  <td className="td"><Link href={`/os/patients/${p.patient_id}`} className="text-navy-700 hover:underline">{names.get(p.patient_id) ?? "—"}</Link></td>
                  <td className="td num">{p.units_used}/{p.units_total}</td>
                  <td className="td num">{money(p.value_used, ctx.locale)} / {money(p.value_total, ctx.locale)}</td>
                  <td className={`td num ${p.status === "active" && p.expires_on < today ? "text-danger" : ""}`}>{p.expires_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
