import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Empty } from "@/components/Empty";
import { Stat } from "@/components/Stat";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { retryMessage, saveMessagingSettings } from "@/app/actions/support";

export const metadata = { title: "Patient messages" };
export const dynamic = "force-dynamic";

type Msg = { id: string; template_code: string; to_phone: string; lang: string; status: string; attempts: number; provider: string | null;
  last_error: string | null; skip_reason: string | null; created_at: string; sent_at: string | null; next_attempt_at: string };

const TEMPLATE: Record<string, [string, string]> = {
  appointment_confirmed: ["تأكيد موعد", "Appointment confirmed"], appointment_reminder: ["تذكير بموعد", "Appointment reminder"],
  appointment_cancelled: ["إلغاء موعد", "Appointment cancelled"], result_released: ["تحديث في حساب المريض", "Portal update"],
  portal_otp: ["رمز دخول", "Sign-in code"],
};
const STATUS: Record<string, [string, string, string]> = {
  queued: ["في الانتظار", "Queued", "pending_confirmation"], sending: ["جارٍ الإرسال", "Sending", "pending_confirmation"],
  sent: ["أُرسلت", "Sent", "confirmed"], delivered: ["وصلت", "Delivered", "completed"], read: ["قُرئت", "Read", "completed"],
  failed: ["فشلت", "Failed", "no_show"], dead: ["توقفت المحاولات", "Gave up", "no_show"], skipped: ["لم تُرسل (رفض المريض)", "Skipped (patient opted out)", "closed"],
};

// Masks the phone: staff here manage delivery, they do not need full numbers.
const mask = (p: string) => (p.length > 6 ? `${p.slice(0, 6)}*****${p.slice(-2)}` : p);

export default async function MessagesPage({ searchParams }: { searchParams: { view?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("messages.manage");
  const { locale } = ctx;
  const ar = locale === "ar";
  const view = ["problems", "all"].includes(searchParams.view ?? "") ? searchParams.view! : "all";
  let q = ctx.supabase.from("message_outbox")
    .select("id, template_code, to_phone, lang, status, attempts, provider, last_error, skip_reason, created_at, sent_at, next_attempt_at")
    .order("created_at", { ascending: false }).limit(200);
  if (view === "problems") q = q.in("status", ["failed", "dead"]);
  const { data } = await q.returns<Msg[]>();
  const rows = data ?? [];
  const count = (s: string[]) => rows.filter((r) => s.includes(r.status)).length;

  const { data: msgSettings } = await ctx.supabase.from("messaging_settings").select("sms_fallback").maybeSingle();
  return (
    <>
      <PageHeader title={ctx.t("nav.messages")} subtitle={ar ? "رسائل واتساب للمرضى: التأكيد والتذكير والإلغاء ورموز الدخول. الرسائل الفاشلة تُعاد تلقائيًا ثم تتوقف بعد 5 محاولات." : "WhatsApp messages to patients. Failed messages retry automatically and stop after 5 attempts."} />
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? "تم حفظ إعدادات الرسائل." : "Messaging settings saved.") : undefined} />
      <form action={saveMessagingSettings} className="card mb-5 flex flex-wrap items-center gap-3 p-4 text-sm" data-messaging-settings>
        <label className="flex items-center gap-2"><input type="checkbox" name="sms_fallback" defaultChecked={Boolean(msgSettings?.sms_fallback)} />
          {ar ? "لو فشل الواتساب نهائيًا، ابعت الرسالة SMS (بتكلفة لكل رسالة)" : "If WhatsApp fails for good, send the message by SMS (costs per message)"}</label>
        <span className="text-xs text-ink-500">{ar ? "المرضى اللي اختاروا SMS كوسيلة تواصل بتوصلهم الرسائل SMS دايمًا." : "Patients whose preferred channel is SMS always get SMS."}</span>
        <SubmitButton pendingLabel="…" className="btn-ghost ms-auto">{ar ? "حفظ" : "Save"}</SubmitButton>
      </form>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "في الانتظار" : "Queued"} value={count(["queued", "sending"])} />
        <Stat label={ar ? "أُرسلت / وصلت" : "Sent / delivered"} value={count(["sent", "delivered", "read"])} tone="teal" />
        <Stat label={ar ? "فشلت" : "Failed"} value={count(["failed", "dead"])} tone={count(["failed", "dead"]) ? "danger" : "navy"} />
        <Stat label={ar ? "لم تُرسل بطلب المريض" : "Opted out"} value={count(["skipped"])} tone="gold" />
      </div>
      <nav className="mb-4 flex flex-wrap gap-2">
        {([["all", "الكل", "All"], ["problems", "المشكلات فقط", "Problems only"]] as const).map(([k, a, e]) => (
          <Link key={k} href={`/os/messages?view=${k}`} className={`rounded-full px-3 py-1.5 text-sm ${k === view ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? a : e}</Link>
        ))}
      </nav>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={ctx.t("common.none")} /> : (
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-ivory-200 bg-ivory-50">
              <tr>
                <th className="th">{ar ? "الرسالة" : "Message"}</th>
                <th className="th">{ar ? "إلى" : "To"}</th>
                <th className="th">{ar ? "الحالة" : "Status"}</th>
                <th className="th">{ar ? "المحاولات" : "Attempts"}</th>
                <th className="th">{ar ? "آخر خطأ" : "Last error"}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200 text-sm">
              {rows.map((m) => {
                const st = STATUS[m.status];
                return (
                  <tr key={m.id} className="hover:bg-ivory-50">
                    <td className="td">{(ar ? TEMPLATE[m.template_code]?.[0] : TEMPLATE[m.template_code]?.[1]) ?? m.template_code}
                      <p className="text-xs text-ink-300">{dateTime(m.created_at, locale)}{m.provider ? ` · ${m.provider}` : ""}</p></td>
                    <td className="td"><span className="num" dir="ltr">{mask(m.to_phone)}</span></td>
                    <td className="td"><StatusBadge status={st?.[2] ?? "draft"} label={(ar ? st?.[0] : st?.[1]) ?? m.status} /></td>
                    <td className="td num">{m.attempts}</td>
                    <td className="td max-w-[260px] truncate text-xs text-ink-500" title={m.last_error ?? m.skip_reason ?? ""}>{m.last_error ?? m.skip_reason ?? "—"}</td>
                    <td className="td">
                      {(m.status === "failed" || m.status === "dead") && (
                        <form action={retryMessage}><input type="hidden" name="id" value={m.id} />
                          <SubmitButton pendingLabel="…" className="btn-ghost text-xs">{ar ? "إعادة الإرسال" : "Retry"}</SubmitButton></form>
                      )}
                    </td>
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
