import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { openCashierSession } from "@/app/actions/billing";
import { PageHeader } from "@/components/PageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { CloseForm } from "./CloseForm";

export const metadata = { title: "Cashier" };
export const dynamic = "force-dynamic";

type Session = { id: string; cashier_id: string; opened_at: string; opening_float: string; status: string; closed_at: string | null;
  expected_cash: string | null; counted_cash: string | null; difference: string | null; close_note: string | null };

export default async function CashierPage({ searchParams }: { searchParams: { error?: string; closed?: string } }) {
  const ctx = await requireAny("cash.session", "cash.supervise");
  const { t, locale } = ctx;
  const ar = locale === "ar";

  const { data: sessions } = await ctx.supabase.from("cashier_sessions").select("*")
    .order("opened_at", { ascending: false }).limit(20).returns<Session[]>();
  const mine = (sessions ?? []).find((s) => s.cashier_id === ctx.user.id && s.status === "open");

  let cashIn = 0;
  let byMethod: Record<string, number> = {};
  if (mine) {
    const { data: pays } = await ctx.supabase.from("payments").select("method, amount").eq("cashier_session_id", mine.id);
    (pays ?? []).forEach((p: { method: string; amount: string }) => {
      byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
      if (p.method === "cash") cashIn += Number(p.amount);
    });
  }

  return (
    <>
      <PageHeader title={t("nav.cashier")} subtitle={t("cash.session")} />
      <Banner error={searchParams.error} success={searchParams.closed ? (ar ? "تم إقفال الوردية." : "Session closed.") : undefined} />

      {ctx.can("cash.session") && (mine ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
            <Stat label={t("cash.float")} value={money(mine.opening_float, locale)} />
            <Stat label={ar ? "نقدية مستلمة" : "Cash received"} value={money(cashIn, locale)} tone="teal" />
            <Stat label={t("cash.expected")} value={money(Number(mine.opening_float) + cashIn, locale)} tone="gold" />
            <div className="card p-4 sm:col-span-3 text-sm text-ink-500">
              {t("cash.openSince")}: <span className="whitespace-nowrap">{dateTime(mine.opened_at, locale)}</span>
              {Object.keys(byMethod).length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-3">
                  {Object.entries(byMethod).map(([m, v]) => <li key={m} className="rounded-full bg-ivory-200 px-3 py-1">{m}: <span className="num">{money(v, locale)}</span></li>)}
                </ul>
              )}
            </div>
          </div>
          <div className="card p-5">
            <h2 className="mb-3 font-medium text-navy-700">{t("cash.close")}</h2>
            <CloseForm sessionId={mine.id} l={{ counted: t("cash.counted"), notes: t("common.notes"), close: t("cash.close"), loading: t("common.loading") }} />
          </div>
        </div>
      ) : (
        <div className="card max-w-md p-5">
          <p className="mb-4 text-sm text-ink-500">{t("cash.none")}</p>
          <form action={openCashierSession} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label" htmlFor="opening_float">{t("cash.float")}</label>
              <input id="opening_float" name="opening_float" type="number" step="0.01" min="0" defaultValue="0" className="input num" />
            </div>
            <SubmitButton pendingLabel="…">{t("cash.open")}</SubmitButton>
          </form>
        </div>
      ))}

      <section className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="border-b border-ivory-200 bg-ivory-50">
            <tr>
              <th className="th">{t("cash.openSince")}</th>
              <th className="th">{t("common.status")}</th>
              <th className="th">{t("cash.expected")}</th>
              <th className="th">{t("cash.counted")}</th>
              <th className="th">{t("cash.difference")}</th>
              <th className="th">{t("common.notes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ivory-200">
            {(sessions ?? []).map((s) => (
              <tr key={s.id}>
                <td className="td whitespace-nowrap">{dateTime(s.opened_at, locale)}</td>
                <td className="td"><StatusBadge status={s.status} label={s.status === "open" ? (ar ? "مفتوحة" : "Open") : (ar ? "مغلقة" : "Closed")} /></td>
                <td className="td num">{s.expected_cash ? money(s.expected_cash, locale) : "—"}</td>
                <td className="td num">{s.counted_cash ? money(s.counted_cash, locale) : "—"}</td>
                <td className={`td num font-medium ${Number(s.difference) < 0 ? "text-danger" : Number(s.difference) > 0 ? "text-warn" : ""}`}>{s.difference != null ? money(s.difference, locale) : "—"}</td>
                <td className="td text-ink-500">{s.close_note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
