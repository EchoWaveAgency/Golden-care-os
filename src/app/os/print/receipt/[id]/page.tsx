import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money, timeOnly } from "@/lib/format";
import type { InvoiceLineRow, InvoiceRow } from "@/lib/types";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

// 80 mm thermal receipt (72 mm printable). Prints from the browser to any ESC/POS printer installed as a system printer.
export default async function ThermalReceipt({ params, searchParams }: { params: { id: string }; searchParams: { payment?: string } }) {
  const ctx = await requireAny("billing.read");
  const ar = ctx.locale === "ar";
  const { data: inv } = await ctx.supabase.from("invoices").select("*").eq("id", params.id).maybeSingle<InvoiceRow>();
  if (!inv || !inv.invoice_no) notFound();
  const [{ data: lines }, { data: payments }, { data: dir }, { data: branch }, { data: ereceipt }, { data: methods }] = await Promise.all([
    ctx.supabase.from("invoice_lines").select("*, service:services(code, name_ar, name_en)").eq("invoice_id", inv.id).returns<InvoiceLineRow[]>(),
    ctx.supabase.from("payments").select("id, receipt_no, method, amount, reference, received_at, status").eq("invoice_id", inv.id).eq("status", "posted").order("received_at"),
    ctx.supabase.rpc("patient_directory", { p_ids: [inv.patient_id] }),
    ctx.supabase.from("branches").select("name_ar, name_en, address_ar, address_en, phone, org:organizations(name_ar, name_en)").eq("id", inv.branch_id).maybeSingle(),
    ctx.supabase.rpc("invoice_ereceipt", { p_invoice: inv.id }),
    ctx.supabase.from("payment_methods").select("code, name_ar, name_en"),
  ]);
  const patient = ((dir ?? []) as { mrn: string; full_name_ar: string }[])[0];
  const b = branch as unknown as { name_ar: string; name_en: string; address_ar: string | null; address_en: string | null; phone: string | null; org: { name_ar: string; name_en: string } } | null;
  const eta = ((ereceipt ?? []) as { status: string; document_uuid: string | null }[])[0];
  const methodName = (c: string) => { const m = (methods ?? []).find((x) => x.code === c); return m ? (ar ? m.name_ar : m.name_en) : c; };
  const shown = searchParams.payment ? (payments ?? []).filter((p) => p.id === searchParams.payment) : payments ?? [];
  const m = (v: number | string) => money(v, ctx.locale);
  const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
    <div className={`flex justify-between gap-2 ${bold ? "font-bold" : ""}`}><span>{k}</span><span className="num">{v}</span></div>
  );

  return (
    <div className="min-h-screen bg-ivory-100 py-6 print:bg-white print:py-0">
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm 4mm; } body { background: #fff; } }`}</style>
      <div className="no-print mx-auto mb-3 flex w-[80mm] justify-between">
        <a href={`/os/billing/${inv.id}`} className="btn-ghost">{ar ? "رجوع" : "Back"}</a>
        <PrintButton label={ctx.t("common.print")} />
      </div>
      <div data-thermal-receipt className="mx-auto w-[72mm] bg-white p-2 font-mono text-[11px] leading-snug text-black shadow print:shadow-none">
        <div className="text-center">
          <div className="text-[14px] font-bold">{ar ? b?.org.name_ar : b?.org.name_en}</div>
          <div>{ar ? b?.name_ar : b?.name_en}</div>
          {(ar ? b?.address_ar : b?.address_en) && <div>{ar ? b?.address_ar : b?.address_en}</div>}
          {b?.phone && <div className="num">{b.phone}</div>}
        </div>
        <div className="my-2 border-t border-dashed border-black" />
        <Row k={ar ? "فاتورة" : "Invoice"} v={inv.invoice_no} />
        <Row k={ar ? "التاريخ" : "Date"} v={dateTime(inv.issued_at ?? inv.created_at, ctx.locale)} />
        <Row k={ar ? "المريض" : "Patient"} v={patient?.full_name_ar ?? "—"} />
        <Row k={ar ? "رقم الملف" : "File no."} v={patient?.mrn ?? "—"} />
        {inv.status === "void" && <div className="mt-1 text-center font-bold">{ar ? "*** فاتورة ملغاة ***" : "*** VOID ***"}</div>}
        <div className="my-2 border-t border-dashed border-black" />
        {(lines ?? []).map((l) => (
          <div key={l.id} className="mb-1">
            <div>{ar ? l.service?.name_ar : l.service?.name_en}</div>
            <Row k={`${Number(l.quantity)} × ${m(l.unit_price)}`} v={m(l.line_gross)} />
            {Number(l.discount) > 0 && <Row k={ar ? "  خصم" : "  Discount"} v={`-${m(l.discount)}`} />}
          </div>
        ))}
        <div className="my-2 border-t border-dashed border-black" />
        <Row k={ar ? "الإجمالي قبل الخصم" : "Subtotal"} v={m(inv.subtotal)} />
        {Number(inv.discount_total) > 0 && <Row k={ar ? "الخصم" : "Discount"} v={`-${m(inv.discount_total)}`} />}
        <Row k={ar ? "الإجمالي" : "Total"} v={m(inv.total)} bold />
        <div className="my-2 border-t border-dashed border-black" />
        {shown.map((p) => (
          <div key={p.id} className="mb-1">
            <Row k={`${ar ? "إيصال" : "Receipt"} ${p.receipt_no}`} v={m(p.amount)} />
            <div className="flex justify-between gap-2 text-[10px]"><span>{methodName(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><span>{timeOnly(p.received_at, ctx.locale)}</span></div>
          </div>
        ))}
        <Row k={ar ? "المدفوع" : "Paid"} v={m(inv.amount_paid)} />
        <Row k={ar ? "المتبقي" : "Balance"} v={m(inv.balance)} bold />
        {eta?.document_uuid && (
          <>
            <div className="my-2 border-t border-dashed border-black" />
            <div className="text-center text-[10px]">{ar ? "الإيصال الإلكتروني (مصلحة الضرائب)" : "E-receipt (Tax Authority)"}</div>
            <div data-ereceipt-uuid className="break-all text-center text-[9px]">{eta.document_uuid}</div>
          </>
        )}
        <div className="my-2 border-t border-dashed border-black" />
        <div className="text-center">{ar ? "شكرًا لثقتكم — نتمنى لكم دوام الصحة" : "Thank you — wishing you good health"}</div>
      </div>
    </div>
  );
}
