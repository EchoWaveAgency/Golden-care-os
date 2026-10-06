import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { decideRefund, payRefund } from "@/app/actions/refunds";
import { decideDepositRefund, payDepositRefund } from "@/app/actions/dental";

export const metadata = { title: "Refunds" };
export const dynamic = "force-dynamic";

type Refund = { id: string; ref: string; invoice_id: string; patient_id: string; amount: number; method: string; reason: string; status: string;
  requested_by: string; requested_at: string; decided_at: string | null; decision_note: string | null; paid_at: string | null; reference: string | null;
  invoice: { invoice_no: string } | null };
type Intent = { id: string; ref: string; invoice_id: string; amount: number; status: string; last_error: string | null; provider: string | null;
  provider_txn_id: string | null; updated_at: string; invoice: { invoice_no: string } | null };

const REFUND_STATUS: Record<string, [string, string, string]> = {
  requested: ["بانتظار الاعتماد", "Awaiting approval", "pending_confirmation"], approved: ["معتمد — بانتظار الصرف", "Approved — to pay", "confirmed"],
  rejected: ["مرفوض", "Rejected", "canceled"], paid: ["تم الصرف", "Paid out", "paid"],
};

export default async function RefundsPage({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const ctx = await requireAny("refund.request", "refund.approve");
  const { locale } = ctx;
  const ar = locale === "ar";
  const [{ data }, { data: methods }, intentsRes, excRes] = await Promise.all([
    ctx.supabase.from("refunds").select("id, ref, invoice_id, patient_id, amount, method, reason, status, requested_by, requested_at, decided_at, decision_note, paid_at, reference, invoice:invoices(invoice_no)")
      .order("requested_at", { ascending: false }).limit(200).returns<Refund[]>(),
    ctx.supabase.from("payment_methods").select("code, name_ar, name_en, requires_reference"),
    ctx.can("billing.read")
      ? ctx.supabase.from("payment_intents").select("id, ref, invoice_id, amount, status, last_error, provider, provider_txn_id, updated_at, invoice:invoices(invoice_no)")
          .in("status", ["review", "paid", "failed"]).order("updated_at", { ascending: false }).limit(30).returns<Intent[]>()
      : Promise.resolve({ data: [] as Intent[] }),
    ctx.can("billing.read")
      ? ctx.supabase.from("payment_exceptions").select("id, provider, txn_id, amount, reason, created_at").is("resolved_at", null).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; provider: string; txn_id: string; amount: number; reason: string; created_at: string }[] }),
  ]);
  const exceptions = excRes.data ?? [];
  const { data: depRef } = await ctx.supabase.from("deposit_refunds").select("id, ref, patient_id, amount, method, reason, status, requested_by, requested_at, decision_note")
    .order("requested_at", { ascending: false }).limit(50);
  const depRows = (depRef ?? []) as { id: string; ref: string; patient_id: string; amount: number; method: string; reason: string; status: string; requested_by: string; requested_at: string; decision_note: string | null }[];
  const rows = data ?? [];
  const pids = Array.from(new Set([...rows.map((r) => r.patient_id), ...depRows.map((r) => r.patient_id)]));
  const { data: dir } = pids.length ? await ctx.supabase.rpc("patient_directory", { p_ids: pids }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; mrn: string; full_name_ar: string }[]).map((p) => [p.id, p]));
  const method = new Map((methods ?? []).map((m) => [m.code, m]));
  const pending = rows.filter((r) => r.status === "requested");
  const toPay = rows.filter((r) => r.status === "approved");
  const intents = intentsRes.data ?? [];
  const review = [...intents.filter((i) => i.status === "review"), ...exceptions];
  const canApprove = ctx.can("refund.approve");
  const canPay = ctx.can("payment.collect");
  const okMsg = searchParams.ok === "paid" ? (ar ? "تم صرف المبلغ وتسجيل القيد." : "Refund paid and posted.") : searchParams.ok ? (ar ? "تم تسجيل القرار." : "Decision recorded.") : undefined;

  return (
    <>
      <PageHeader title={ctx.t("nav.refunds")} subtitle={ar ? "كل استرداد يمر بثلاث خطوات: طلب ← اعتماد من شخص آخر ← صرف بقيد محاسبي." : "Every refund goes request → approval by someone else → payout with a journal entry."} />
      <Banner error={searchParams.error} success={okMsg} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "بانتظار الاعتماد" : "Awaiting approval"} value={pending.length} tone={pending.length ? "gold" : "navy"} />
        <Stat label={ar ? "معتمد بانتظار الصرف" : "Approved, to pay"} value={toPay.length} tone="teal" />
        <Stat label={ar ? "مدفوعات إلكترونية تحتاج مراجعة" : "Online payments to review"} value={review.length} tone={review.length ? "danger" : "navy"} />
        <Stat label={ar ? "إجمالي المصروف (آخر 200)" : "Paid out (last 200)"} value={money(rows.filter((r) => r.status === "paid").reduce((a, r) => a + Number(r.amount), 0), locale)} />
      </div>

      <div className="space-y-3">
        {rows.length === 0 && <div className="card"><Empty text={ctx.t("common.none")} /></div>}
        {rows.map((r) => {
          const p = names.get(r.patient_id);
          const st = REFUND_STATUS[r.status];
          const m = method.get(r.method);
          const mine = r.requested_by === ctx.user.id;
          return (
            <article key={r.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm"><span className="num font-medium text-navy-700">{r.ref}</span> · <Link href={`/os/billing/${r.invoice_id}`} className="num text-teal-700 hover:underline">{r.invoice?.invoice_no}</Link></p>
                  <p className="mt-1 text-lg font-semibold"><span className="num">{money(r.amount, locale)}</span> <span className="text-sm font-normal text-ink-500">· {ar ? m?.name_ar : m?.name_en}</span></p>
                  <p className="text-sm">{r.reason}</p>
                  <p className="mt-1 text-xs text-ink-300">{p ? `${p.full_name_ar} · ${p.mrn} · ` : ""}{dateTime(r.requested_at, locale)}{r.decision_note ? ` · ${r.decision_note}` : ""}{r.reference ? ` · ${r.reference}` : ""}</p>
                </div>
                <StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? r.status} />
              </div>
              {r.status === "requested" && canApprove && (mine
                ? <p className="mt-3 text-xs text-ink-500">{ar ? "قدّمت هذا الطلب بنفسك — يلزم اعتماد مسؤول آخر." : "You requested this — another approver is required."}</p>
                : (
                  <form action={decideRefund} className="mt-4 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="min-w-[220px] flex-1"><label className="label" htmlFor={`n-${r.id}`}>{ar ? "ملاحظة (مطلوبة عند الرفض)" : "Note (required to reject)"}</label><input id={`n-${r.id}`} name="note" className="input" /></div>
                    <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                    <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-danger">{ar ? "رفض" : "Reject"}</SubmitButton>
                  </form>
                ))}
              {r.status === "approved" && canPay && (
                <form action={payRefund} className="mt-4 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  {m?.requires_reference && <div><label className="label" htmlFor={`ref-${r.id}`}>{ar ? "رقم مرجع التحويل" : "Transfer reference"}</label><input id={`ref-${r.id}`} name="reference" required className="input" dir="ltr" /></div>}
                  <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "صرف المبلغ" : "Pay out"}</SubmitButton>
                </form>
              )}
            </article>
          );
        })}
      </div>

      {depRows.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "استرداد من الرصيد المقدم" : "Refunds of advance balances"}</h2>
          <div className="space-y-3">
            {depRows.map((r) => {
              const pt = names.get(r.patient_id);
              const st = REFUND_STATUS[r.status];
              const m = method.get(r.method);
              const mineReq = r.requested_by === ctx.user.id;
              return (
                <article key={r.id} className="card p-4" data-deposit-refund={r.ref}>
                  <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
                    <div><p><span className="num font-medium text-navy-700">{r.ref}</span> · <Link href={`/os/patients/${r.patient_id}`} className="text-teal-700 hover:underline">{pt?.full_name_ar ?? ""}</Link></p>
                      <p className="mt-1 font-semibold"><span className="num">{money(r.amount, locale)}</span> <span className="text-sm font-normal text-ink-500">· {ar ? m?.name_ar : m?.name_en}</span></p>
                      <p>{r.reason}</p><p className="text-xs text-ink-300">{dateTime(r.requested_at, locale)}{r.decision_note ? ` · ${r.decision_note}` : ""}</p></div>
                    <StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? r.status} />
                  </div>
                  {r.status === "requested" && canApprove && (mineReq
                    ? <p className="mt-2 text-xs text-ink-500">{ar ? "قدّمت هذا الطلب بنفسك — يلزم اعتماد مسؤول آخر." : "You requested this — another approver is required."}</p>
                    : <form action={decideDepositRefund} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.id} />
                        <input name="note" placeholder={ar ? "ملاحظة (مطلوبة عند الرفض)" : "Note (required to reject)"} className="input w-56" />
                        <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                        <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-danger">{ar ? "رفض" : "Reject"}</SubmitButton></form>)}
                  {r.status === "approved" && canPay && (
                    <form action={payDepositRefund} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={r.id} />
                      {m?.requires_reference && <input name="reference" required placeholder={ar ? "رقم مرجع التحويل" : "Transfer reference"} className="input" dir="ltr" />}
                      <SubmitButton pendingLabel="…" className="btn-gold">{ar ? "صرف المبلغ" : "Pay out"}</SubmitButton></form>)}
                </article>);
            })}
          </div>
        </section>
      )}

      {exceptions.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-medium text-danger">{ar ? "مبالغ خُصمت من المريض ولم تُطابق فاتورة — يلزم ردها أو تسويتها" : "Captured but unmatched — refund or allocate"}</h2>
          <ul className="card divide-y divide-ivory-200 text-sm">
            {exceptions.map((x) => (
              <li key={x.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span>{x.reason} <span className="text-xs text-ink-300" dir="ltr">{x.provider}:{x.txn_id}</span></span>
                <span className="num font-medium">{money(x.amount, locale)} <span className="text-xs font-normal text-ink-300">{dateTime(x.created_at, locale)}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ctx.can("billing.read") && (
        <section className="mt-8">
          <h2 className="mb-3 font-medium text-navy-700">{ar ? "المدفوعات الإلكترونية من حساب المريض" : "Online payments from the patient account"}</h2>
          <div className="card overflow-x-auto">
            {intents.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
              <table className="w-full min-w-[720px] text-sm">
                <tbody className="divide-y divide-ivory-200">
                  {intents.map((i) => (
                    <tr key={i.id} className={i.status === "review" ? "bg-danger-50/50" : ""}>
                      <td className="td"><span className="num">{i.ref}</span><p className="text-xs text-ink-300">{dateTime(i.updated_at, locale)}</p></td>
                      <td className="td"><Link href={`/os/billing/${i.invoice_id}`} className="num text-teal-700 hover:underline">{i.invoice?.invoice_no}</Link></td>
                      <td className="td num">{money(i.amount, locale)}</td>
                      <td className="td">{i.status === "paid" ? (ar ? "تم التحصيل" : "Captured") : i.status === "failed" ? (ar ? "مرفوض من البنك" : "Declined") : (ar ? "يحتاج مراجعة: المبلغ خُصم ولم يُسجَّل تلقائيًا" : "Needs review: captured but not auto-posted")}</td>
                      <td className="td text-xs text-ink-500">{i.last_error ?? i.provider_txn_id ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </>
  );
}
