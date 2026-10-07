import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { einvoiceMode } from "@/lib/einvoice/connector";
import { retryEinvoice, saveEinvoiceSettings, setServiceTax } from "@/app/actions/einvoice";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { ar: string; en: string; tone: string }> = {
  pending: { ar: "في الانتظار", en: "Queued", tone: "text-ink-500" }, blocked: { ar: "ناقص بيانات", en: "Blocked", tone: "text-warn" },
  sent: { ar: "جارٍ الإرسال", en: "Sending", tone: "text-ink-500" }, accepted: { ar: "مقبول", en: "Accepted", tone: "text-teal-700" },
  rejected: { ar: "مرفوض", en: "Rejected", tone: "text-danger" }, failed: { ar: "فشل الإرسال", en: "Failed", tone: "text-danger" }, cancelled: { ar: "ملغى", en: "Cancelled", tone: "text-ink-500" },
};
const KIND: Record<string, { ar: string; en: string }> = {
  receipt: { ar: "إيصال إلكتروني", en: "E-receipt" }, invoice: { ar: "فاتورة إلكترونية", en: "E-invoice" }, return: { ar: "مرتجع", en: "Return" }, cancellation: { ar: "إلغاء", en: "Cancellation" },
};

type Doc = { id: string; doc_no: string; kind: string; status: string; block_reason: string | null; last_error: string | null; created_at: string; long_id: string | null; payload: { total?: number } };
type Svc = { id: string; code: string; name_ar: string; name_en: string; eta_item_type: string | null; eta_item_code: string | null; eta_unit: string; tax_type: string | null; tax_subtype: string | null; tax_rate: number | null };

export default async function EinvoicePage({ searchParams }: { searchParams: { error?: string; ok?: string; tab?: string } }) {
  const ctx = await requireAny("accounting.read", "accounting.configure");
  const ar = ctx.locale === "ar";
  const tab = searchParams.tab ?? "queue";
  const [{ data: st }, { data: docs }, { data: svcs }] = await Promise.all([
    ctx.supabase.from("einvoice_settings").select("*").maybeSingle(),
    ctx.supabase.from("einvoice_documents").select("id, doc_no, kind, status, block_reason, last_error, created_at, long_id, payload").order("created_at", { ascending: false }).limit(100).returns<Doc[]>(),
    ctx.supabase.from("services").select("id, code, name_ar, name_en, eta_item_type, eta_item_code, eta_unit, tax_type, tax_subtype, tax_rate").eq("is_active", true).order("code").returns<Svc[]>(),
  ]);
  const configure = ctx.can("accounting.configure");
  const missing = (svcs ?? []).filter((x) => !x.eta_item_code || !x.eta_item_type || !x.tax_type || x.tax_rate == null);
  const count = (s: string) => (docs ?? []).filter((d) => d.status === s).length;
  const ok = { saved: ar ? "تم الحفظ." : "Saved.", service: ar ? "تم حفظ بيانات الخدمة." : "Service saved.", retried: ar ? "أُعيد بناء المستند وإدراجه للإرسال." : "Rebuilt and queued again." }[searchParams.ok ?? ""];
  const mode = einvoiceMode();
  return (
    <>
      <PageHeader title={ar ? "الفاتورة والإيصال الإلكتروني" : "E-invoicing and e-receipts"}
        subtitle={ar ? "منظومة مصلحة الضرائب المصرية. المعالجة الضريبية لكل خدمة يحددها محاسب العيادة؛ لا يُرسل مستند ناقص." : "Egyptian Tax Authority system. The tax treatment of each service is set by the clinic's accountant; incomplete documents are never sent."}
        actions={<Link href="/os/accounting" className="btn-ghost">{ar ? "الحسابات" : "Accounting"}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      <p className={`mb-4 rounded-xl border px-4 py-2 text-sm ${mode === "dev" ? "border-gold-300 bg-gold-50" : "border-ivory-300 bg-white"}`} data-einvoice-mode>
        {mode === "dev" ? (ar ? "وضع المحاكاة المحلي: المستندات تُقبل بأرقام تجريبية ولا تصل للمصلحة." : "Local simulator: documents are accepted with test ids and never reach the Tax Authority.")
          : (ar ? "الربط بالمصلحة غير مفعل: المستندات تُجهز وتنتظر. يتطلب الربط بيانات الدخول من بوابة المصلحة واجتياز الاختبار على بيئة ما قبل الإنتاج." : "Not connected to the Tax Authority: documents are prepared and wait. Connecting needs the portal credentials and passing pre-production tests.")}
        {!st?.enabled && (ar ? " — والتجهيز متوقف من الإعدادات." : " — and document preparation is switched off in the settings.")}</p>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "مقبولة" : "Accepted"} value={count("accepted")} tone="teal" />
        <Stat label={ar ? "في الانتظار" : "Queued"} value={count("pending") + count("sent")} />
        <Stat label={ar ? "ناقصة بيانات" : "Blocked"} value={count("blocked")} tone={count("blocked") ? "gold" : "teal"} />
        <Stat label={ar ? "خدمات بدون إعداد ضريبي" : "Services without tax setup"} value={missing.length} tone={missing.length ? "gold" : "teal"} />
      </div>
      <nav className="mb-3 flex gap-2 text-sm">{[["queue", ar ? "المستندات" : "Documents"], ["services", ar ? "أكواد الخدمات والضرائب" : "Service codes & tax"], ["settings", ar ? "الإعدادات" : "Settings"]].map(([k, l]) => (
        <a key={k} href={`?tab=${k}`} className={`rounded-full px-3 py-1 ${k === tab ? "bg-teal-700 text-white" : "bg-white text-navy-700"}`}>{l}</a>))}</nav>

      {tab === "queue" && (
        <ul className="card divide-y divide-ivory-200 text-sm" data-einvoice-docs>
          {(docs ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
          {(docs ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" data-einvoice-doc={d.status}>
              <span><span className="num font-medium">{d.doc_no}</span> · {ar ? KIND[d.kind]?.ar : KIND[d.kind]?.en} · <span className="num">{money(Number(d.payload?.total ?? 0), ctx.locale)}</span>
                <span className="block text-xs text-ink-500">{dateTime(d.created_at, ctx.locale)}{d.long_id ? ` · ${d.long_id}` : ""}</span>
                {d.block_reason && <span className="block text-xs text-warn">{ar ? "ناقص: " : "Missing: "}{d.block_reason}</span>}
                {d.last_error && <span className="block text-xs text-danger">{d.last_error}</span>}</span>
              <span className="flex items-center gap-2"><span className={STATUS[d.status]?.tone}>{ar ? STATUS[d.status]?.ar : STATUS[d.status]?.en}</span>
                {configure && ["blocked", "failed", "rejected"].includes(d.status) && <form action={retryEinvoice}><input type="hidden" name="id" value={d.id} />
                  <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "إعادة البناء والإرسال" : "Rebuild and send"}</SubmitButton></form>}</span>
            </li>))}
        </ul>)}

      {tab === "services" && (
        <ul className="space-y-2 text-sm" data-service-tax>
          {(svcs ?? []).map((x) => (
            <li key={x.id} className="card p-3">
              <form action={setServiceTax} className="flex flex-wrap items-end gap-2"><input type="hidden" name="service_id" value={x.id} />
                <span className="min-w-48"><span className="num text-xs text-ink-500">{x.code}</span><span className="block">{ar ? x.name_ar : x.name_en}</span></span>
                <select name="eta_item_type" defaultValue={x.eta_item_type ?? ""} disabled={!configure} className="input w-24 py-1 text-xs"><option value="">—</option><option value="EGS">EGS</option><option value="GS1">GS1</option></select>
                <input name="eta_item_code" defaultValue={x.eta_item_code ?? ""} disabled={!configure} placeholder={ar ? "كود الصنف" : "Item code"} className="input w-48 py-1 text-xs" dir="ltr" />
                <input name="eta_unit" defaultValue={x.eta_unit} disabled={!configure} className="input w-16 py-1 text-xs" dir="ltr" title={ar ? "وحدة القياس" : "Unit"} />
                <input name="tax_type" defaultValue={x.tax_type ?? ""} disabled={!configure} placeholder={ar ? "نوع الضريبة" : "Tax type"} className="input w-24 py-1 text-xs" dir="ltr" />
                <input name="tax_subtype" defaultValue={x.tax_subtype ?? ""} disabled={!configure} placeholder={ar ? "النوع الفرعي" : "Subtype"} className="input w-24 py-1 text-xs" dir="ltr" />
                <input name="tax_rate" type="number" min="0" max="100" step="0.001" defaultValue={x.tax_rate ?? ""} disabled={!configure} placeholder="%" className="input num w-20 py-1 text-xs" />
                {configure && <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "حفظ" : "Save"}</SubmitButton>}
                {(!x.eta_item_code || !x.tax_type || x.tax_rate == null) && <span className="text-xs text-warn">{ar ? "ناقص" : "incomplete"}</span>}
              </form>
            </li>))}
        </ul>)}

      {tab === "settings" && (
        <form action={saveEinvoiceSettings} className="card grid gap-3 p-5 text-sm md:grid-cols-3" data-einvoice-settings>
          <label className="flex items-center gap-2 md:col-span-3"><input type="checkbox" name="enabled" defaultChecked={st?.enabled ?? false} disabled={!configure} />{ar ? "تجهيز المستندات الإلكترونية تلقائيًا عند إصدار الفواتير والمرتجعات" : "Prepare electronic documents automatically when invoices and refunds are issued"}</label>
          <label><span className="label">{ar ? "نوع المستند" : "Document type"}</span><select name="document_kind" defaultValue={st?.document_kind ?? "receipt"} disabled={!configure} className="input">
            <option value="receipt">{ar ? "إيصال إلكتروني (أفراد)" : "E-receipt (consumers)"}</option><option value="invoice">{ar ? "فاتورة إلكترونية" : "E-invoice"}</option></select></label>
          <label><span className="label">{ar ? "البيئة" : "Environment"}</span><select name="environment" defaultValue={st?.environment ?? "preprod"} disabled={!configure} className="input">
            <option value="preprod">{ar ? "ما قبل الإنتاج (اختبار)" : "Pre-production (test)"}</option><option value="production">{ar ? "الإنتاج" : "Production"}</option></select></label>
          <label><span className="label">{ar ? "رقم التسجيل الضريبي (9 أرقام)" : "Tax registration no. (9 digits)"}</span><input name="taxpayer_rin" defaultValue={st?.taxpayer_rin ?? ""} disabled={!configure} className="input" dir="ltr" /></label>
          <label><span className="label">{ar ? "اسم الممول" : "Taxpayer name"}</span><input name="taxpayer_name" defaultValue={st?.taxpayer_name ?? ""} disabled={!configure} className="input" /></label>
          <label><span className="label">{ar ? "كود النشاط (4 أرقام)" : "Activity code (4 digits)"}</span><input name="activity_code" defaultValue={st?.activity_code ?? ""} disabled={!configure} className="input" dir="ltr" /></label>
          <label><span className="label">{ar ? "كود الفرع" : "Branch code"}</span><input name="branch_code" defaultValue={st?.branch_code ?? ""} disabled={!configure} className="input" dir="ltr" /></label>
          <label><span className="label">{ar ? "الرقم التسلسلي لنقطة البيع" : "POS serial"}</span><input name="pos_serial" defaultValue={st?.pos_serial ?? ""} disabled={!configure} className="input" dir="ltr" /></label>
          <p className="text-xs text-ink-500 md:col-span-3">{ar ? "بيانات الدخول السرية (Client ID / Secret) تُضبط في متغيرات البيئة على السيرفر، ولا تُخزن في قاعدة البيانات." : "Secret credentials (client id / secret) are set as server environment variables, never stored in the database."}</p>
          {configure && <div className="md:col-span-3"><SubmitButton pendingLabel="…">{ar ? "حفظ" : "Save"}</SubmitButton></div>}
        </form>)}
    </>
  );
}
