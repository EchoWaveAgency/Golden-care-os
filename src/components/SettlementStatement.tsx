import Image from "next/image";
import { notFound } from "next/navigation";
import type { Ctx } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";
import { SubmitButton } from "./SubmitButton";
import { PrintButton } from "./PrintButton";
import { Banner } from "./Banner";
import { approveSettlement, cancelSettlement, paySettlement } from "@/app/actions/settlements";

type Run = { id: string; ref: string; doctor_id: string; period: string; status: string; gross_base: number; deductions: number; amount: number;
  lines_without_contract: number; carried_in: number; carried_to: string | null; stale: boolean; approved_by: string | null; prepared_by: string; prepared_at: string; approved_at: string | null; paid_at: string | null; pay_reference: string | null;
  cancel_reason: string | null; doctor: { full_name_ar: string; full_name_en: string | null; specialty: { name_ar: string; name_en: string } | null } | null };
type Line = { id: string; kind: string; on_date: string; invoice_no: string | null; base: number; percent: number | null; fixed_amount: number | null; amount: number; no_contract: boolean;
  service: { code: string; name_ar: string; name_en: string } | null; refund: { ref: string } | null };

export const SETTLEMENT_STATUS: Record<string, [string, string, string]> = {
  draft: ["مسودة — بانتظار الاعتماد", "Draft — awaiting approval", "pending_confirmation"], approved: ["معتمد — بانتظار الصرف", "Approved — to pay", "confirmed"],
  paid: ["تم الصرف", "Paid", "paid"], cancelled: ["ملغي", "Cancelled", "canceled"],
};

export function monthLabel(period: string, locale: "ar" | "en") {
  const from = period.replace(/[[()\]]/g, "").split(",")[0];
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));
}

export async function SettlementStatement({ ctx, id, error, ok, manage }: { ctx: Ctx; id: string; error?: string; ok?: string; manage: boolean }) {
  const ar = ctx.locale === "ar";
  const { data: run } = await ctx.supabase.from("settlement_runs")
    .select("id, ref, doctor_id, period, status, gross_base, deductions, amount, lines_without_contract, carried_in, carried_to, stale, approved_by, prepared_by, prepared_at, approved_at, paid_at, pay_reference, cancel_reason, doctor:staff(full_name_ar, full_name_en, specialty:specialties(name_ar, name_en))")
    .eq("id", id).maybeSingle<Run>();
  if (!run) notFound();
  const { data: lines } = await ctx.supabase.from("settlement_lines")
    .select("id, kind, on_date, invoice_no, base, percent, fixed_amount, amount, no_contract, service:services(code, name_ar, name_en), refund:refunds(ref)")
    .eq("run_id", id).order("on_date").returns<Line[]>();
  const st = SETTLEMENT_STATUS[run.status];
  const doc = run.doctor;
  const kind = (k: string) => (k === "carry" ? (ar ? "رصيد سالب مُرحّل من كشف سابق" : "Negative balance carried from an earlier statement") : k === "refund" ? (ar ? "خصم استرداد" : "Refund deduction") : k === "void_reversal" ? (ar ? "عكس فاتورة ملغاة" : "Voided invoice reversal") : k === "package_session" ? (ar ? "جلسة من باقة (القيمة المعترف بها)" : "Package session (recognised value)") : "");
  const okMsg = ok === "approved" ? (ar ? "تم اعتماد الكشف وتسجيل القيد." : "Approved and posted.") : ok === "paid" ? (ar ? "تم تسجيل الصرف." : "Payment recorded.") : ok === "cancelled" ? (ar ? "تم إلغاء الكشف." : "Statement cancelled.") : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="no-print"><Banner error={error} success={okMsg} /></div>
      <article className="card p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-gold-500 pb-4">
          <div>
            <p className="text-sm text-ink-500">{ar ? "كشف مستحقات طبيب" : "Doctor settlement statement"} · <span className="num">{run.ref}</span></p>
            <h1 className="text-xl font-semibold text-navy-700">{ar ? doc?.full_name_ar : doc?.full_name_en ?? doc?.full_name_ar}</h1>
            <p className="text-sm text-ink-500">{ar ? doc?.specialty?.name_ar : doc?.specialty?.name_en} · {monthLabel(run.period, ctx.locale)}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? run.status} />
            <PrintButton label={ctx.t("common.print")} />
            <Image src="/brand/emblem.png" alt="" width={70} height={44} className="hidden print:block" />
          </div>
        </header>
        {run.stale && run.status === "draft" && (
          <p className="mt-4 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn">{ar ? "تغيّر عقد الطبيب بعد إعداد هذا الكشف. ألغِه وأعد إعداده ليُحسب بالعقد الجديد." : "The doctor's contract changed after this statement was prepared. Cancel and prepare it again."}</p>
        )}
        {run.carried_to && (
          <p className="mt-4 rounded-lg bg-ivory-200 px-3 py-2 text-sm text-ink-500">{ar ? "هذا الرصيد السالب رُحّل إلى الكشف التالي." : "This negative balance was carried into the next statement."}</p>
        )}
        {run.lines_without_contract > 0 && (
          <p className="mt-4 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">{ar ? `${run.lines_without_contract} خدمة بدون عقد سارٍ (قيمتها صفر). أضف العقد ثم ألغِ الكشف وأعد إعداده.` : `${run.lines_without_contract} service line(s) without a valid contract (valued at zero). Add the contract, then cancel and prepare again.`}</p>
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr><th className="th">{ar ? "التاريخ" : "Date"}</th><th className="th">{ar ? "الفاتورة" : "Invoice"}</th><th className="th">{ar ? "البند" : "Item"}</th>
                <th className="th">{ar ? "الأساس" : "Base"}</th><th className="th">{ar ? "النسبة / المبلغ الثابت" : "Rate"}</th><th className="th">{ar ? "المستحق" : "Due"}</th></tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {(lines ?? []).map((l) => (
                <tr key={l.id} className={l.no_contract ? "bg-danger-50/50" : l.amount < 0 ? "text-danger" : ""}>
                  <td className="td whitespace-nowrap">{dateTime(`${l.on_date}T12:00:00Z`, ctx.locale, { timeStyle: undefined })}</td>
                  <td className="td num">{l.invoice_no}{l.refund ? ` · ${l.refund.ref}` : ""}</td>
                  <td className="td">{l.service ? `${ar ? l.service.name_ar : l.service.name_en}` : ""}{kind(l.kind) ? <span className="block text-xs">{kind(l.kind)}</span> : null}</td>
                  <td className="td num">{money(l.base, ctx.locale)}</td>
                  <td className="td num">{l.no_contract ? (ar ? "بدون عقد" : "No contract") : l.fixed_amount != null ? `${money(l.fixed_amount, ctx.locale)} ${ar ? "للوحدة" : "/unit"}` : l.percent != null ? `${Number(l.percent)}%` : ar ? "بالنسبة" : "pro rata"}</td>
                  <td className="td num font-medium">{money(l.amount, ctx.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ms-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between text-ink-500"><dt>{ar ? "إجمالي الخدمات (بعد خصومات البنود)" : "Services (net of line discounts)"}</dt><dd className="num">{money(run.gross_base, ctx.locale)}</dd></div>
          <div className="flex justify-between text-ink-500"><dt>{ar ? "الخصومات (استرداد / إلغاء)" : "Deductions (refunds / voids)"}</dt><dd className="num">{money(run.deductions, ctx.locale)}</dd></div>
          {Number(run.carried_in) !== 0 && <div className="flex justify-between text-ink-500"><dt>{ar ? "رصيد مُرحّل" : "Carried balance"}</dt><dd className="num">{money(run.carried_in, ctx.locale)}</dd></div>}
          <div className="flex justify-between border-t border-ivory-300 pt-1 text-base font-semibold text-navy-700"><dt>{ar ? "صافي المستحق" : "Net due"}</dt><dd className="num">{money(run.amount, ctx.locale)}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-ink-300">
          {ar ? "أُعد في" : "Prepared"} {dateTime(run.prepared_at, ctx.locale)}
          {run.approved_at ? ` · ${ar ? "اعتُمد في" : "approved"} ${dateTime(run.approved_at, ctx.locale)}` : ""}
          {run.paid_at ? ` · ${ar ? "صُرف في" : "paid"} ${dateTime(run.paid_at, ctx.locale)} (${run.pay_reference})` : ""}
          {run.cancel_reason ? ` · ${run.cancel_reason}` : ""}
        </p>
      </article>

      {manage && (
        <div className="no-print mt-5 flex flex-wrap gap-4">
          {run.status === "draft" && ctx.can("settlement.approve") && (run.prepared_by === ctx.user.id
            ? <p className="text-sm text-ink-500">{ar ? "أعددت هذا الكشف — يلزم اعتماد مسؤول آخر." : "You prepared this — another approver is required."}</p>
            : <form action={approveSettlement}><input type="hidden" name="id" value={run.id} /><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "اعتماد وترحيل القيد" : "Approve and post"}</SubmitButton></form>)}
          {run.status === "draft" && ctx.can("settlement.prepare") && (
            <form action={cancelSettlement} className="flex items-center gap-2"><input type="hidden" name="id" value={run.id} />
              <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-48" />
              <SubmitButton pendingLabel="…" className="btn-danger">{ar ? "إلغاء الكشف" : "Cancel statement"}</SubmitButton></form>
          )}
          {run.status === "approved" && run.amount > 0 && ctx.can("settlement.pay") && run.approved_by === ctx.user.id && (
            <p className="text-sm text-ink-500">{ar ? "اعتمدت هذا الكشف — يسجل الصرف شخص آخر." : "You approved this — someone else records the payment."}</p>
          )}
          {run.status === "approved" && run.amount > 0 && ctx.can("settlement.pay") && run.approved_by !== ctx.user.id && (
            <form action={paySettlement} className="flex items-center gap-2"><input type="hidden" name="id" value={run.id} />
              <input name="reference" required placeholder={ar ? "رقم التحويل البنكي" : "Bank transfer reference"} className="input w-56" dir="ltr" />
              <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "تسجيل الصرف" : "Record payment"}</SubmitButton></form>
          )}
        </div>
      )}
    </div>
  );
}
