import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import type { InvoiceRow, InvoiceStatus } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import type { DictKey } from "@/lib/i18n";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const FILTERS: (InvoiceStatus | "open")[] = ["open", "draft", "issued", "partially_paid", "paid", "void"];

export default async function BillingPage({ searchParams }: { searchParams: { status?: string } }) {
  const ctx = await requireAny("billing.read");
  const { t, locale } = ctx;
  const status = FILTERS.includes(searchParams.status as InvoiceStatus) ? searchParams.status! : "open";

  let q = ctx.supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(100);
  if (status === "open") q = q.in("status", ["issued", "partially_paid"]);
  else q = q.eq("status", status);
  const { data } = await q.returns<InvoiceRow[]>();
  const rows = data ?? [];

  // Minimal patient identification (works for finance roles without clinical access).
  const ids = Array.from(new Set(rows.map((r) => r.patient_id)));
  const { data: dir } = ids.length ? await ctx.supabase.rpc("patient_directory", { p_ids: ids }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; mrn: string; full_name_ar: string }[]).map((d) => [d.id, d]));
  const outstanding = rows.filter((r) => ["issued", "partially_paid"].includes(r.status)).reduce((s, r) => s + Number(r.balance), 0);

  return (
    <>
      <PageHeader title={t("nav.billing")} subtitle={status === "open" ? `${t("exec.outstanding")}: ${money(outstanding, locale)}` : undefined} />
      <nav className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f} href={`/os/billing?status=${f}`}
            className={`rounded-full px-3 py-1.5 text-sm ${f === status ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>
            {f === "open" ? t("exec.outstanding") : t(`bill.status.${f}` as DictKey)}
          </Link>
        ))}
      </nav>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{t("bill.invoice")}</th>
                <th className="th">{t("apt.patient")}</th>
                <th className="th">{t("common.date")}</th>
                <th className="th">{t("bill.net")}</th>
                <th className="th">{t("bill.balance")}</th>
                <th className="th">{t("common.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-ivory-50">
                  <td className="td"><Link href={`/os/billing/${i.id}`} className="num font-medium text-navy-700 hover:underline">{i.invoice_no ?? t("bill.draft")}</Link></td>
                  <td className="td">{names.get(i.patient_id)?.full_name_ar ?? "—"} <span className="num text-xs text-ink-300">{names.get(i.patient_id)?.mrn}</span></td>
                  <td className="td text-ink-500 whitespace-nowrap">{dateTime(i.issued_at ?? i.created_at, locale)}</td>
                  <td className="td num">{money(i.total, locale)}</td>
                  <td className="td num font-medium">{money(i.balance, locale)}</td>
                  <td className="td"><StatusBadge status={i.status} label={t(`bill.status.${i.status}` as DictKey)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
