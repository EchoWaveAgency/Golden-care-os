import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";
import { StatusBadge } from "@/components/StatusBadge";
import { PO_STATUS } from "@/lib/purchasing";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { savePurchasingSettings } from "@/app/actions/purchasing";

export const metadata = { title: "Purchasing" };
export const dynamic = "force-dynamic";


export default async function PurchasingPage({ searchParams }: { searchParams: { view?: string; ok?: string; error?: string } }) {
  const ctx = await requireAny("purchase.read", "purchase.request", "purchase.approve");
  const ar = ctx.locale === "ar";
  const view = searchParams.view === "all" ? "all" : "open";
  let q = ctx.supabase.from("purchase_orders").select("id, ref, status, total, created_at, expected_on, supplier:suppliers(name_ar, name_en)").order("created_at", { ascending: false }).limit(100);
  if (view === "open") q = q.in("status", ["draft", "submitted", "approved", "partially_received"]);
  const canConfigure = ctx.can("accounting.configure");
  const { data: ps } = await ctx.supabase.from("purchasing_settings").select("po_high_approval_above, payment_high_approval_above, vat_treatment").maybeSingle();
  const { data } = await q.returns<{ id: string; ref: string; status: string; total: number; created_at: string; expected_on: string | null; supplier: { name_ar: string; name_en: string | null } | null }[]>();
  return (
    <>
      <PageHeader title={ctx.t("nav.purchasing")} subtitle={ar ? "أمر الشراء يعتمده شخص غير الذي أنشأه، والاستلام عليه يلتزم بأصنافه وكمياته وأسعاره." : "Orders are approved by someone other than their author; receipts must match their items, quantities and prices."}
        actions={ctx.can("purchase.request") ? <Link href="/os/purchasing/new" className="btn-primary">{ar ? "أمر شراء جديد" : "New purchase order"}</Link> : undefined} />
      <Banner error={searchParams.error} success={searchParams.ok === "settings" ? (ar ? "تم حفظ إعدادات المشتريات." : "Purchasing settings saved.") : undefined} />
      {(canConfigure || ps?.po_high_approval_above != null || ps?.payment_high_approval_above != null) && (
        <details className="card mb-4 p-4 text-sm" data-purchasing-settings open={!ps}>
          <summary className="cursor-pointer font-medium text-navy-700">{ar ? "حدود الاعتماد وضريبة المشتريات" : "Approval limits and purchase VAT"}
            <span className="ms-2 text-xs font-normal text-ink-500">{ps?.po_high_approval_above != null ? `${ar ? "أمر شراء أعلى من" : "PO above"} ${money(ps.po_high_approval_above, ctx.locale)}` : (ar ? "بدون حد لأوامر الشراء" : "No PO limit")} · {ps?.payment_high_approval_above != null ? `${ar ? "دفعة أعلى من" : "payment above"} ${money(ps.payment_high_approval_above, ctx.locale)}` : (ar ? "بدون حد للدفعات" : "no payment limit")}</span></summary>
          {canConfigure && (
            <form action={savePurchasingSettings} className="mt-3 grid gap-3 md:grid-cols-4">
              <label><span className="label">{ar ? "أمر شراء يحتاج اعتمادًا ثانيًا فوق (ج.م)" : "PO needs a second approval above (EGP)"}</span>
                <input name="po_high_approval_above" type="number" min="0" step="0.01" defaultValue={ps?.po_high_approval_above ?? ""} placeholder={ar ? "فارغ = بدون" : "empty = off"} className="input num" /></label>
              <label><span className="label">{ar ? "دفعة مورد تحتاج مدير المركز فوق (ج.م)" : "Supplier payment needs the director above (EGP)"}</span>
                <input name="payment_high_approval_above" type="number" min="0" step="0.01" defaultValue={ps?.payment_high_approval_above ?? ""} placeholder={ar ? "فارغ = بدون" : "empty = off"} className="input num" /></label>
              <label><span className="label">{ar ? "معالجة ضريبة القيمة المضافة على المشتريات" : "VAT on purchases"}</span>
                <select name="vat_treatment" defaultValue={ps?.vat_treatment ?? ""} className="input"><option value="">{ar ? "— لم تُحدد —" : "— not set —"}</option>
                  <option value="recoverable">{ar ? "قابلة للخصم (أصل)" : "Recoverable (asset)"}</option><option value="expense">{ar ? "غير قابلة للخصم (مصروف)" : "Not recoverable (expense)"}</option></select></label>
              <div className="flex items-end"><SubmitButton pendingLabel="…">{ar ? "حفظ" : "Save"}</SubmitButton></div>
              <p className="text-xs text-ink-500 md:col-span-4">{ar ? "القيم يحددها مجلس الإدارة والمستشار الضريبي. لو خدمات العيادة معفاة من الضريبة فغالبًا الضريبة على المشتريات غير قابلة للخصم — راجع المستشار." : "Values are set by management and the tax adviser. If the clinic's services are VAT-exempt, purchase VAT is usually not recoverable — check with the adviser."}</p>
            </form>)}
        </details>)}
      <nav className="mb-4 flex gap-2">
        {([["open", "المفتوحة", "Open"], ["all", "الكل", "All"]] as const).map(([k, a, e]) => <Link key={k} href={`/os/purchasing?view=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>)}
      </nav>
      <div className="card">
        {(data ?? []).length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200 text-sm">
            {(data ?? []).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <Link href={`/os/purchasing/${p.id}`} className="hover:underline"><span className="num font-medium text-navy-700">{p.ref}</span> · {ar ? p.supplier?.name_ar : p.supplier?.name_en ?? p.supplier?.name_ar}
                  <span className="block text-xs text-ink-300">{dateTime(p.created_at, ctx.locale)}{p.expected_on ? ` · ${ar ? "متوقع" : "expected"} ${p.expected_on}` : ""}</span></Link>
                <span className="flex items-center gap-3"><span className="num font-medium">{money(p.total, ctx.locale)}</span>
                  <StatusBadge status={PO_STATUS[p.status]?.[2] ?? "draft"} label={(ar ? PO_STATUS[p.status]?.[0] : PO_STATUS[p.status]?.[1]) ?? p.status} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
