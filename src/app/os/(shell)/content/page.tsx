import Link from "next/link";
import { requireAny } from "@/lib/session";
import { CONTENT_TYPES, STATUS_LABEL } from "@/lib/content";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";

export const metadata = { title: "Website content" };
export const dynamic = "force-dynamic";

type Row = { id: string; status: string; version: number; updated_at: string; published_at: string | null; published_data: unknown;
  ends_at?: string | null; review_due_at?: string | null; [k: string]: unknown };

export default async function ContentIndex({ searchParams }: { searchParams: { type?: string } }) {
  const ctx = await requireAny("content.edit", "content.medical_approve", "content.marketing_approve", "content.publish");
  const ar = ctx.locale === "ar";
  const type = CONTENT_TYPES.find((c) => c.key === searchParams.type) ?? CONTENT_TYPES[0];
  const { data } = await ctx.supabase.from(type.table).select("*").order("updated_at", { ascending: false }).returns<Row[]>();
  const rows = data ?? [];
  const now = Date.now();
  const needsMe = (s: string) =>
    (s === "medical_review" && ctx.can("content.medical_approve")) ||
    (s === "marketing_review" && ctx.can("content.marketing_approve")) ||
    (s === "approved" && ctx.can("content.publish"));

  return (
    <>
      <PageHeader title={ctx.t("nav.content")}
        subtitle={ar ? "لا يظهر أي محتوى طبي أو عرض أو سعر على الموقع إلا بعد الاعتماد الطبي والتسويقي والنشر." : "Nothing medical, no offer and no price reaches the website before medical and marketing approval and publication."}
        actions={ctx.can("content.edit") ? <Link href={`/os/content/${type.key}/new`} className="btn-primary">{ar ? "إضافة" : "Add"}</Link> : null} />
      <nav className="mb-4 flex flex-wrap gap-2">
        {CONTENT_TYPES.map((c) => (
          <Link key={c.key} href={`/os/content?type=${c.key}`} className={`rounded-full px-3 py-1.5 text-sm ${c.key === type.key ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? c.ar : c.en}</Link>
        ))}
        <Link href="/ar" target="_blank" className="rounded-full px-3 py-1.5 text-sm text-teal-700 hover:underline">{ctx.t("nav.site")} ↗</Link>
      </nav>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{ar ? "العنوان" : "Title"}</th>
                <th className="th">{ar ? "الحالة" : "Status"}</th>
                <th className="th">{ar ? "على الموقع" : "On website"}</th>
                <th className="th">{ar ? "الإصدار" : "Version"}</th>
                <th className="th">{ar ? "آخر تعديل" : "Updated"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {rows.map((r) => {
                const live = r.published_data && r.status !== "archived" && r.published_at && new Date(r.published_at).getTime() <= now;
                const expired = r.ends_at && new Date(r.ends_at).getTime() < now;
                const reviewDue = r.review_due_at && new Date(r.review_due_at).getTime() < now;
                return (
                  <tr key={r.id} className="hover:bg-ivory-50">
                    <td className="td">
                      <Link href={`/os/content/${type.key}/${r.id}`} className="font-medium text-navy-700 hover:underline">{String(r[type.titleField] ?? r.slug ?? r.id)}</Link>
                      <p className="num text-xs text-ink-300">/{String(r.slug ?? "")}</p>
                    </td>
                    <td className="td">
                      <StatusBadge status={r.status === "published" ? "paid" : r.status === "archived" ? "void" : r.status === "draft" ? "draft" : "pending_confirmation"}
                        label={STATUS_LABEL[r.status]?.[ar ? "ar" : "en"] ?? r.status} />
                      {needsMe(r.status) && <span className="ms-2 text-xs font-medium text-ember">{ar ? "بانتظارك" : "Needs you"}</span>}
                    </td>
                    <td className="td">
                      {live ? <span className="text-ok">{ar ? "ظاهر" : "Live"}</span> : <span className="text-ink-300">{ar ? "غير ظاهر" : "Not live"}</span>}
                      {expired && <p className="text-xs text-danger">{ar ? "منتهي — يختفي تلقائيًا" : "Expired — hidden automatically"}</p>}
                      {reviewDue && <p className="text-xs text-warn">{ar ? "موعد المراجعة الطبية فات" : "Medical review overdue"}</p>}
                    </td>
                    <td className="td num">v{r.version}</td>
                    <td className="td whitespace-nowrap text-ink-500">{dateTime(r.updated_at, ctx.locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
