import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Empty } from "@/components/Empty";

export const metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

type Ev = { id: number; occurred_at: string; actor_id: string | null; action: string; table_name: string; record_id: string | null; changed: string[] | null; reason: string | null };

export default async function AuditPage({ searchParams }: { searchParams: { table?: string } }) {
  const ctx = await requireAny("audit.read");
  const { t, locale } = ctx;
  let q = ctx.supabase.from("audit_events").select("id, occurred_at, actor_id, action, table_name, record_id, changed, reason")
    .order("occurred_at", { ascending: false }).limit(150);
  if (searchParams.table && /^[a-z_]+$/.test(searchParams.table)) q = q.eq("table_name", searchParams.table);
  const { data } = await q.returns<Ev[]>();
  const rows = data ?? [];
  const actors = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  const { data: profiles } = actors.length
    ? await ctx.supabase.from("profiles").select("user_id, full_name_ar, full_name_en").in("user_id", actors)
    : { data: [] };
  const who = new Map((profiles ?? []).map((p: { user_id: string; full_name_ar: string; full_name_en: string | null }) => [p.user_id, locale === "ar" ? p.full_name_ar : p.full_name_en ?? p.full_name_ar]));

  return (
    <>
      <PageHeader title={t("nav.audit")} actions={
        <form className="flex gap-2">
          <input name="table" defaultValue={searchParams.table} placeholder="patients, invoices…" className="input" dir="ltr" aria-label={t("audit.table")} />
          <button className="btn-primary">{t("common.search")}</button>
        </form>
      } />
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={t("common.none")} /> : (
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{t("audit.when")}</th>
                <th className="th">{t("audit.actor")}</th>
                <th className="th">{t("audit.action")}</th>
                <th className="th">{t("audit.table")}</th>
                <th className="th">{t("audit.record")}</th>
                <th className="th">{t("common.notes")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200 text-sm">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="td whitespace-nowrap text-ink-500 whitespace-nowrap">{dateTime(r.occurred_at, locale)}</td>
                  <td className="td">{r.actor_id ? who.get(r.actor_id) ?? r.actor_id.slice(0, 8) : "system"}</td>
                  <td className="td font-medium">{r.action}</td>
                  <td className="td num">{r.table_name}</td>
                  <td className="td num text-xs text-ink-300">{r.record_id?.slice(0, 8)}</td>
                  <td className="td text-xs text-ink-500">{r.changed?.join(", ")}{r.reason ? ` — ${r.reason}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
