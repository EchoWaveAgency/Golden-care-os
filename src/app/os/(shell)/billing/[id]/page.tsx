import { notFound } from "next/navigation";
import Image from "next/image";
import { randomUUID } from "node:crypto";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import type { InvoiceLineRow, InvoiceRow } from "@/lib/types";
import { addInvoiceLine, removeInvoiceLine, issueInvoice, voidInvoice } from "@/app/actions/billing";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import { PrintButton } from "@/components/PrintButton";
import { PaymentForm } from "./PaymentForm";
import { requestRefund } from "@/app/actions/refunds";
import { applyAdvance } from "@/app/actions/dental";
import type { DictKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; paid?: string; ok?: string } }) {
  const ctx = await requireAny("billing.read");
  const { t, locale } = ctx;
  const ar = locale === "ar";

  const { data: inv } = await ctx.supabase.from("invoices").select("*").eq("id", params.id).maybeSingle<InvoiceRow>();
  if (!inv) notFound();

  const [{ data: lines }, { data: payments }, { data: dir }, { data: services }, { data: methods }, { data: doctors }] = await Promise.all([
    ctx.supabase.from("invoice_lines").select("*, service:services(code, name_ar, name_en)").eq("invoice_id", inv.id).returns<InvoiceLineRow[]>(),
    ctx.supabase.from("payments").select("id, receipt_no, method, amount, reference, received_at").eq("invoice_id", inv.id).order("received_at"),
    ctx.supabase.rpc("patient_directory", { p_ids: [inv.patient_id] }),
    inv.status === "draft" ? ctx.supabase.from("services").select("id, code, name_ar, name_en").eq("is_active", true).order("code") : Promise.resolve({ data: [] }),
    ctx.supabase.from("payment_methods").select("code, name_ar, name_en, requires_reference").eq("is_active", true).not("code", "in", "(online,advance)"),
    inv.status === "draft" ? ctx.supabase.from("staff").select("id, full_name_ar, full_name_en").eq("kind", "doctor").eq("is_active", true) : Promise.resolve({ data: [] }),
  ]);
  const { data: refunds } = await ctx.supabase.from("refunds").select("id, ref, amount, status, reason, requested_at").eq("invoice_id", inv.id).order("requested_at");
  const refundable = Number(inv.amount_paid) - Number(inv.refunded_total ?? 0)
    - (refunds ?? []).filter((r) => r.status === "requested" || r.status === "approved").reduce((a, r) => a + Number(r.amount), 0);
  const patient = ((dir ?? []) as { mrn: string; full_name_ar: string }[])[0];
  const isDraft = inv.status === "draft";
  const canPay = ["issued", "partially_paid"].includes(inv.status) && ctx.can("payment.collect");
  const { data: advData } = canPay ? await ctx.supabase.rpc("patient_advance", { p_patient: inv.patient_id }) : { data: [] };
  const advAvail = Number((((advData ?? []) as { available: number }[])[0]?.available) ?? 0);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print">
        <PageHeader
          title={`${t("bill.invoice")} ${inv.invoice_no ?? `(${t("bill.draft")})`}`}
          subtitle={patient ? `${patient.full_name_ar} · ${patient.mrn}` : undefined}
          actions={<><StatusBadge status={inv.status} label={t(`bill.status.${inv.status}` as DictKey)} />{!isDraft && <PrintButton label={t("common.print")} />}</>}
        />
        <Banner error={searchParams.error} success={searchParams.paid ? (ar ? "تم تسجيل الدفعة وإصدار الإيصال." : "Payment recorded and receipt issued.") : searchParams.ok === "refund_requested" ? (ar ? "تم إرسال طلب الاسترداد للاعتماد." : "Refund request sent for approval.") : searchParams.ok === "plan_billed" ? (ar ? "تمت فوترة البنود المنفذة وخصمها من الرصيد المقدم بقدر المتاح." : "Completed work billed; the advance balance was applied where available.")
          : searchParams.ok === "advance_applied" ? (ar ? "تم الخصم من الرصيد المقدم." : "Paid from the advance balance.")
          : searchParams.ok === "package" ? (ar ? "تم بيع الباقة وإصدار الفاتورة. حصّل المبلغ؛ الجلسات تُستخدم بعد السداد الكامل." : "Package sold and invoice issued. Collect payment; sessions can be used once it is fully paid.") : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          {/* Print header */}
          <div className="hidden items-center justify-between border-b border-ivory-200 p-5 print:flex">
            <div>
              <p className="text-lg font-semibold">{t("app.name")}</p>
              <p className="num text-sm">{t("bill.invoice")} {inv.invoice_no} · {inv.issued_at ? dateTime(inv.issued_at, locale) : ""}</p>
              {patient && <p className="text-sm">{patient.full_name_ar} · <span className="num">{patient.mrn}</span></p>}
            </div>
            <Image src="/brand/emblem.png" alt="" width={90} height={57} />
          </div>

          {(lines ?? []).length === 0 ? <Empty text={t("common.none")} /> : (
            <table className="w-full">
              <thead className="border-b border-ivory-200 bg-ivory-50">
                <tr>
                  <th className="th">{t("bill.service")}</th>
                  <th className="th">{t("bill.qty")}</th>
                  <th className="th">{t("bill.price")}</th>
                  <th className="th">{t("bill.discount")}</th>
                  <th className="th">{t("bill.lineTotal")}</th>
                  {isDraft && <th className="th no-print" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-ivory-200">
                {(lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="td">{ar ? l.service?.name_ar : l.service?.name_en} <span className="num text-xs text-ink-300">{l.service?.code}</span></td>
                    <td className="td num">{Number(l.quantity)}</td>
                    <td className="td num">{money(l.unit_price, locale)}</td>
                    <td className="td num text-ink-500">{Number(l.discount) ? money(l.discount, locale) : "—"}</td>
                    <td className="td num font-medium">{money(l.line_total, locale)}</td>
                    {isDraft && (
                      <td className="td no-print">
                        <form action={removeInvoiceLine}>
                          <input type="hidden" name="invoice_id" value={inv.id} />
                          <input type="hidden" name="line_id" value={l.id} />
                          <button className="text-xs text-danger hover:underline">✕</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <dl className="space-y-1 border-t border-ivory-200 p-5 text-sm">
            <Sum k={t("bill.subtotal")} v={money(inv.subtotal, locale)} />
            <Sum k={t("bill.discount")} v={money(inv.discount_total, locale)} />
            <Sum k={t("bill.net")} v={money(inv.total, locale)} strong />
            <Sum k={t("bill.paid")} v={money(inv.amount_paid, locale)} />
            <Sum k={t("bill.balance")} v={money(inv.balance, locale)} strong />
            {Number(inv.refunded_total ?? 0) > 0 && <Sum k={ar ? "تم رده للمريض" : "Refunded to patient"} v={money(inv.refunded_total ?? 0, locale)} />}
          </dl>

          {isDraft && ctx.can("billing.write") && (
            <form key={`add-${(lines ?? []).length}`} action={addInvoiceLine} className="no-print grid gap-2 border-t border-ivory-200 p-5 sm:grid-cols-6">
              <input type="hidden" name="invoice_id" value={inv.id} />
              <select name="service_id" required className="input sm:col-span-2" aria-label={t("bill.service")}>
                {(services ?? []).map((s: { id: string; code: string; name_ar: string; name_en: string }) => (
                  <option key={s.id} value={s.id}>{s.code} — {ar ? s.name_ar : s.name_en}</option>
                ))}
              </select>
              <select name="doctor_id" className="input sm:col-span-2" aria-label={t("apt.doctor")}>
                <option value="">{t("apt.doctor")} —</option>
                {(doctors ?? []).map((d: { id: string; full_name_ar: string; full_name_en: string | null }) => (
                  <option key={d.id} value={d.id}>{ar ? d.full_name_ar : d.full_name_en ?? d.full_name_ar}</option>
                ))}
              </select>
              <input name="quantity" type="number" min="1" step="1" defaultValue="1" className="input num" aria-label={t("bill.qty")} />
              <input name="discount" type="number" min="0" step="0.01" defaultValue="0" className="input num" aria-label={t("bill.discount")} />
              <div className="sm:col-span-6 flex justify-end"><SubmitButton pendingLabel="…" className="btn-ghost">{t("bill.addLine")}</SubmitButton></div>
            </form>
          )}
        </section>

        <aside className="no-print space-y-5">
          {isDraft && ctx.can("billing.write") && (
            <div className="card p-5">
              <p className="mb-3 text-sm text-ink-500">{t("bill.issueHint")}</p>
              <form action={issueInvoice}>
                <input type="hidden" name="invoice_id" value={inv.id} />
                <SubmitButton pendingLabel={t("common.loading")} className="btn-primary w-full">{t("bill.issue")}</SubmitButton>
              </form>
            </div>
          )}

          {canPay && advAvail > 0 && (
            <form action={applyAdvance} className="card space-y-2 border-gold-300 p-5" data-apply-advance>
              <h2 className="font-medium text-navy-700">{ar ? "الخصم من الرصيد المقدم" : "Pay from the advance balance"}</h2>
              <p className="text-sm text-ink-500">{ar ? "المتاح للمريض:" : "Available:"} <span className="num font-medium">{money(advAvail, locale)}</span></p>
              <input type="hidden" name="invoice_id" value={inv.id} /><input type="hidden" name="idempotency_key" value={randomUUID()} />
              <input name="amount" type="number" min="0.01" step="0.01" max={Math.min(advAvail, Number(inv.balance))} defaultValue={Math.min(advAvail, Number(inv.balance))} className="input num" aria-label={t("bill.amount")} />
              <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "خصم" : "Apply"}</SubmitButton>
            </form>
          )}
          {canPay && (
            <div className="card p-5">
              <h2 className="mb-3 font-medium text-navy-700">{t("bill.pay")}</h2>
              <PaymentForm
                key={`pay-${inv.amount_paid}`}
                invoiceId={inv.id}
                balance={inv.balance}
                idempotencyKey={randomUUID()}
                methods={(methods ?? []).map((m: { code: string; name_ar: string; name_en: string; requires_reference: boolean }) => ({
                  code: m.code, name: ar ? m.name_ar : m.name_en, requires_reference: m.requires_reference,
                }))}
                l={{ amount: t("bill.amount"), method: t("bill.method"), reference: t("bill.reference"), pay: t("bill.pay"), loading: t("common.loading") }}
              />
            </div>
          )}

          <div className="card p-5">
            <h2 className="mb-3 font-medium text-navy-700">{t("bill.receipts")}</h2>
            {(payments ?? []).length === 0 ? <p className="text-sm text-ink-300">{t("common.none")}</p> : (
              <ul className="space-y-2 text-sm">
                {(payments ?? []).map((p: { id: string; receipt_no: string; method: string; amount: string; reference: string | null; received_at: string }) => (
                  <li key={p.id} className="flex justify-between">
                    <span><span className="num">{p.receipt_no}</span> <span className="text-xs text-ink-300">· {p.method}{p.reference ? ` · ${p.reference}` : ""}</span></span>
                    <span className="num font-medium">{money(p.amount, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {((refunds ?? []).length > 0 || (refundable > 0 && ctx.can("refund.request"))) && (
            <div className="card p-5">
              <h2 className="mb-3 font-medium text-navy-700">{ar ? "الاسترداد" : "Refunds"}</h2>
              {(refunds ?? []).length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {(refunds ?? []).map((r) => (
                    <li key={r.id} className="flex justify-between gap-2"><span><span className="num">{r.ref}</span> <span className="text-xs text-ink-300">· {r.status}</span></span><span className="num">{money(r.amount, locale)}</span></li>
                  ))}
                </ul>
              )}
              {refundable > 0 && ctx.can("refund.request") && (
                <details>
                  <summary className="cursor-pointer text-sm text-teal-700">{ar ? "طلب استرداد" : "Request a refund"}</summary>
                  <form action={requestRefund} className="mt-3 space-y-2">
                    <input type="hidden" name="invoice_id" value={inv.id} />
                    <label className="label" htmlFor="rf-amount">{ar ? "المبلغ (المتاح" : "Amount (available"} <span className="num">{money(refundable, locale)}</span>)</label>
                    <input id="rf-amount" name="amount" type="number" min="0.01" step="0.01" max={refundable} required className="input num" />
                    <label className="label" htmlFor="rf-method">{ar ? "طريقة الرد" : "Refund method"}</label>
                    <select id="rf-method" name="method" className="input">
                      {(methods ?? []).map((m: { code: string; name_ar: string; name_en: string }) => <option key={m.code} value={m.code}>{ar ? m.name_ar : m.name_en}</option>)}
                    </select>
                    <label className="label" htmlFor="rf-reason">{ar ? "السبب" : "Reason"}</label>
                    <input id="rf-reason" name="reason" required minLength={3} className="input" />
                    <SubmitButton pendingLabel="…" className="btn-ghost w-full">{ar ? "إرسال للاعتماد" : "Send for approval"}</SubmitButton>
                  </form>
                </details>
              )}
            </div>
          )}

          {inv.status === "issued" && Number(inv.amount_paid) === 0 && ctx.can("invoice.void") && (
            <details className="card p-5">
              <summary className="cursor-pointer text-sm text-danger">{t("bill.void")}</summary>
              <form action={voidInvoice} className="mt-3 space-y-2">
                <input type="hidden" name="invoice_id" value={inv.id} />
                <label className="label" htmlFor="reason">{t("bill.voidReason")}</label>
                <input id="reason" name="reason" required minLength={3} className="input" />
                <SubmitButton pendingLabel="…" className="btn-danger w-full"
                  confirm={ar ? "سيتم عكس القيد المحاسبي. متابعة؟" : "The accounting entry will be reversed. Continue?"}>{t("bill.void")}</SubmitButton>
              </form>
            </details>
          )}
          {inv.status === "void" && inv.void_reason && (
            <p className="rounded-lg bg-ivory-200 p-3 text-sm text-ink-500">{t("common.reason")}: {inv.void_reason}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Sum({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-navy-700" : "text-ink-500"}`}>
      <dt>{k}</dt><dd className="num">{v}</dd>
    </div>
  );
}
