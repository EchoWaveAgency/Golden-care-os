import { requireAny } from "@/lib/session";
import { LEAVE_STATUS, lab } from "@/lib/hr";
import { cancelLeave, decideLeave } from "@/app/actions/hr";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { HrTabs } from "../HrTabs";

export const dynamic = "force-dynamic";

type L = { id: string; ref: string; leave_type: string; from_date: string; to_date: string; days: number; reason: string | null; status: string; decision_note: string | null;
  employee: { id: string; staff: { full_name_ar: string; full_name_en: string | null } | null } | null; type: { name_ar: string; name_en: string; paid: boolean } | null };

export default async function LeavePage({ searchParams }: { searchParams: { error?: string; ok?: string; tab?: string } }) {
  const ctx = await requireAny("hr.read", "leave.approve");
  const ar = ctx.locale === "ar";
  const tab = searchParams.tab === "all" ? "all" : "requested";
  let q = ctx.supabase.from("leave_requests").select("id, ref, leave_type, from_date, to_date, days, reason, status, decision_note, employee:employees(id, staff:staff(full_name_ar, full_name_en)), type:leave_types(name_ar, name_en, paid)")
    .order("from_date", { ascending: tab === "requested" }).limit(200);
  if (tab === "requested") q = q.eq("status", "requested");
  const { data } = await q.returns<L[]>();
  const decide = ctx.can("leave.approve"), manage = ctx.can("hr.manage");
  return (
    <>
      <PageHeader title={ar ? "الإجازات" : "Leave"} subtitle={ar ? "الموظف يطلب من «بياناتي»؛ الاعتماد من مسؤول غير صاحب الطلب." : "Employees request from “My file”; someone else approves."} />
      <HrTabs active="leave" ar={ar} can={(p) => ctx.can(p)} />
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? "تم." : "Done.") : undefined} />
      <nav className="mb-3 flex gap-2 text-sm">{[["requested", ar ? "بانتظار القرار" : "Awaiting decision"], ["all", ar ? "الكل" : "All"]].map(([k, l]) => (
        <a key={k} href={`?tab=${k}`} className={`rounded-full px-3 py-1 ${k === tab ? "bg-teal-700 text-white" : "bg-white text-navy-700"}`}>{l}</a>))}</nav>
      <ul className="card divide-y divide-ivory-200 text-sm" data-leave-list>
        {(data ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
        {(data ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3" data-leave={l.ref}>
            <div><p className="font-medium">{ar ? l.employee?.staff?.full_name_ar : l.employee?.staff?.full_name_en ?? l.employee?.staff?.full_name_ar} · {ar ? l.type?.name_ar : l.type?.name_en}</p>
              <p className="text-xs text-ink-500"><span className="num">{l.from_date} → {l.to_date}</span> · {l.days} {ar ? "يوم عمل" : "working days"}{l.reason ? ` · ${l.reason}` : ""} · {lab(LEAVE_STATUS, l.status, ar)}{l.decision_note ? ` · ${l.decision_note}` : ""}</p></div>
            {decide && l.status === "requested" && (
              <form action={decideLeave} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={l.id} />
                <input name="note" placeholder={ar ? "ملاحظة (مطلوبة للرفض)" : "Note (needed to reject)"} className="input w-48 py-1 text-xs" />
                <SubmitButton name="decision" value="approve" pendingLabel="…" className="btn-primary px-2 py-1 text-xs">{ar ? "اعتماد" : "Approve"}</SubmitButton>
                <SubmitButton name="decision" value="reject" pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "رفض" : "Reject"}</SubmitButton></form>)}
            {manage && l.status === "approved" && (
              <form action={cancelLeave} className="flex items-end gap-2"><input type="hidden" name="id" value={l.id} /><input type="hidden" name="back" value="/os/hr/leave?tab=all" />
                <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-40 py-1 text-xs" />
                <SubmitButton pendingLabel="…" className="btn-ghost px-2 py-1 text-xs">{ar ? "إلغاء" : "Cancel"}</SubmitButton></form>)}
          </li>))}
      </ul>
    </>
  );
}
