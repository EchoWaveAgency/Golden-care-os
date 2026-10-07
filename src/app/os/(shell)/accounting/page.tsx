import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import type { DictKey } from "@/lib/i18n";

export const metadata = { title: "Accounting" };
export const dynamic = "force-dynamic";

type TB = { account_id: string; code: string; name_ar: string; name_en: string; type: string; debit: number; credit: number; balance: number };
type JE = { id: string; ref: string; entry_date: string; description: string; source_type: string; status: string; created_at: string;
  lines: { debit: string; credit: string; memo: string | null; account: { code: string; name_ar: string; name_en: string } | null }[] };

export default async function AccountingPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const ctx = await requireAny("accounting.read");
  const { t, locale } = ctx;
  const today = clinicToday();
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
  const from = valid(searchParams.from) ?? today.slice(0, 8) + "01";
  const to = valid(searchParams.to) ?? today;

  const { data: branch } = await ctx.supabase.from("branches").select("organization_id").limit(1).maybeSingle();
  const [{ data: tb }, { data: entries }] = await Promise.all([
    branch ? ctx.supabase.rpc("trial_balance", { p_org: branch.organization_id, p_from: from, p_to: to }) : Promise.resolve({ data: [] }),
    ctx.supabase.from("journal_entries")
      .select("id, ref, entry_date, description, source_type, status, created_at, lines:journal_lines(debit, credit, memo, account:accounts(code, name_ar, name_en))")
      .gte("entry_date", from).lte("entry_date", to).order("created_at", { ascending: false }).limit(30).returns<JE[]>(),
  ]);
  const rows = ((tb ?? []) as TB[]).filter((r) => Number(r.debit) || Number(r.credit));
  const totD = rows.reduce((s, r) => s + Number(r.debit), 0);
  const totC = rows.reduce((s, r) => s + Number(r.credit), 0);
  const balanced = Math.abs(totD - totC) < 0.005;
  const nm = (a: { name_ar: string; name_en: string } | null) => (a ? (locale === "ar" ? a.name_ar : a.name_en) : "");
  const srcLabel = (s: string) => {
    const k = `acc.src.${s}` as DictKey;
    return ["invoice_issue", "payment", "invoice_void", "reversal", "manual"].includes(s) ? t(k) : s;
  };

  return (
    <>
      <PageHeader
        title={t("nav.accounting")}
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="from">{t("acc.from")}</label><input id="from" type="date" name="from" defaultValue={from} className="input" /></div>
            <div><label className="label" htmlFor="to">{t("acc.to")}</label><input id="to" type="date" name="to" defaultValue={to} className="input" /></div>
            <button className="btn-primary">{t("common.search")}</button>
            <Link href="/os/accounting/einvoice" className="btn-ghost">{ctx.locale === "ar" ? "الفاتورة الإلكترونية" : "E-invoicing"}</Link>
          </form>
        }
      />

      <section className="card mb-6 overflow-x-auto">
        <div className="flex items-center justify-between border-b border-ivory-200 px-5 py-3">
          <h2 className="font-medium text-navy-700">{t("acc.trialBalance")}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${balanced ? "bg-ok-50 text-ok" : "bg-danger-50 text-danger"}`}>
            {balanced ? t("acc.balanced") : t("acc.unbalanced")}
          </span>
        </div>
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <table className="w-full min-w-[640px]">
            <thead className="bg-ivory-50">
              <tr>
                <th className="th">{t("acc.code")}</th>
                <th className="th">{t("acc.account")}</th>
                <th className="th">{t("acc.debit")}</th>
                <th className="th">{t("acc.credit")}</th>
                <th className="th">{t("acc.balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((r) => (
                <tr key={r.account_id}>
                  <td className="td num text-ink-500">{r.code}</td>
                  <td className="td">{nm(r)}</td>
                  <td className="td num">{money(r.debit, locale)}</td>
                  <td className="td num">{money(r.credit, locale)}</td>
                  <td className="td num font-medium">{money(r.balance, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-navy-700/20 font-semibold">
              <tr>
                <td className="td" colSpan={2}>{t("common.total")}</td>
                <td className="td num">{money(totD, locale)}</td>
                <td className="td num">{money(totC, locale)}</td>
                <td className="td num">{money(totD - totC, locale)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>

      <section className="card">
        <h2 className="border-b border-ivory-200 px-5 py-3 font-medium text-navy-700">{t("acc.entries")}</h2>
        {(entries ?? []).length === 0 ? <Empty text={t("common.none")} /> : (
          <ul className="divide-y divide-ivory-200">
            {(entries ?? []).map((e) => (
              <li key={e.id}>
                <details className="group px-5 py-3">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
                    <span><span className="num font-medium">{e.ref}</span> · {srcLabel(e.source_type)}</span>
                    <span className="flex items-center gap-3">
                      <span className="num text-ink-500">{e.entry_date}</span>
                      <StatusBadge status={e.status} label={t(e.status === "reversed" ? "acc.status.reversed" : "acc.status.posted")} />
                    </span>
                  </summary>
                  <table className="mt-3 w-full table-fixed text-sm">
                    <colgroup><col className="w-20" /><col /><col className="w-36" /><col className="w-36" /></colgroup>
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i} className="border-t border-ivory-200">
                          <td className="py-1.5 num text-ink-500">{l.account?.code}</td>
                          <td className="py-1.5">{nm(l.account)}</td>
                          <td className="py-1.5 num">{Number(l.debit) ? money(l.debit, locale) : ""}</td>
                          <td className="py-1.5 num">{Number(l.credit) ? money(l.credit, locale) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-ink-300 whitespace-nowrap">{dateTime(e.created_at, locale)}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
