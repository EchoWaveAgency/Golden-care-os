import { getPortal } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime } from "@/lib/format";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusBadge } from "@/components/StatusBadge";
import { portalTicket } from "@/app/actions/portal";

type Ticket = { ref: string; kind: string; subject: string; status: string; created_at: string; resolution: string | null };
const KIND: Record<string, [string, string]> = {
  inquiry: ["استفسار", "Question"], complaint: ["شكوى", "Complaint"], callback: ["اتصلوا بي", "Call me back"],
  reschedule: ["تغيير موعد", "Change an appointment"], refund: ["استرداد مبلغ", "Refund"],
};
const STATUS: Record<string, [string, string, string]> = {
  open: ["تم الاستلام", "Received", "pending_confirmation"], in_progress: ["قيد المعالجة", "In progress", "confirmed"],
  resolved: ["تم الحل", "Resolved", "completed"], closed: ["مغلق", "Closed", "closed"],
};

export default async function PortalSupport({ params, searchParams }: { params: { lang: Lang }; searchParams: { ok?: string; error?: string } }) {
  const { supabase, active, ar, lang } = await getPortal(params.lang);
  const { data } = await supabase.rpc("portal_tickets", { p_patient: active.id });
  const list = (data ?? []) as Ticket[];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "الشكاوى والطلبات" : "Requests & complaints"}</h1>
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? `تم استلام طلبك رقم ${searchParams.ok}. الشكاوى يرد عليها خلال 24 ساعة وباقي الطلبات خلال 4 ساعات عمل.` : `Request ${searchParams.ok} received. Complaints are answered within 24 hours, other requests within 4 working hours.`) : undefined} />
      <form action={portalTicket} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
        <input type="hidden" name="lang" value={lang} />
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="kind">{ar ? "النوع" : "Type"}</label>
            <select id="kind" name="kind" className="input">{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="subject">{ar ? "الموضوع" : "Subject"}</label><input id="subject" name="subject" required minLength={2} maxLength={200} className="input" /></div>
          <div className="sm:col-span-3"><label className="label" htmlFor="body">{ar ? "التفاصيل" : "Details"}</label><textarea id="body" name="body" rows={4} maxLength={2000} className="input" /></div>
        </div>
        <p className="my-3 text-xs text-ink-300">{ar ? "لا تكتب هنا أي حالة طارئة. في الطوارئ اتصل بالإسعاف 123 أو توجّه لأقرب مستشفى." : "Do not use this for emergencies. In an emergency call 123 or go to the nearest hospital."}</p>
        <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إرسال" : "Send"}</SubmitButton>
      </form>
      <section>
        <h2 className="mb-3 font-medium text-navy-700">{ar ? "طلباتك" : "Your requests"}</h2>
        {list.length === 0 ? <p className="text-sm text-ink-500">{ar ? "لا توجد طلبات." : "No requests yet."}</p> : (
          <ul className="space-y-3">
            {list.map((t) => (
              <li key={t.ref} className="rounded-2xl border border-ivory-300/70 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.subject}</p>
                    <p className="text-xs text-ink-500">{ar ? KIND[t.kind]?.[0] : KIND[t.kind]?.[1]} · <span className="num">{t.ref}</span> · {dateTime(t.created_at, lang)}</p>
                  </div>
                  <StatusBadge status={STATUS[t.status]?.[2] ?? "draft"} label={(ar ? STATUS[t.status]?.[0] : STATUS[t.status]?.[1]) ?? t.status} />
                </div>
                {t.resolution && <p className="mt-3 rounded-lg bg-ok-50 p-3 text-sm text-ok">{t.resolution}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
