import { redirect } from "next/navigation";
import { getPortal } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { dateTime, money } from "@/lib/format";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { portalAcceptPlan } from "@/app/actions/portal";
import { startPayment } from "@/app/actions/portal-pay";
import { paymentsMode } from "@/lib/payments/gateway";

type Plan = { id: string; ref: string; title: string; status: string; total: number; valid_until: string | null; max_installments: number; accepted_at: string | null;
  doctor_ar: string; doctor_en: string; due_now: number;
  items: { service_ar: string; service_en: string; tooth: string | null; qty: number; total: number; status: string }[] | null;
  installments: { seq: number; due_on: string; amount: number; paid: number }[] | null };

const STATUS: Record<string, [string, string]> = { proposed: ["بانتظار موافقتك", "Awaiting your acceptance"], accepted: ["مقبولة", "Accepted"],
  in_progress: ["قيد التنفيذ", "In progress"], completed: ["مكتملة", "Completed"] };

export default async function PortalPlans({ params, searchParams }: { params: { lang: Lang }; searchParams: { error?: string; ok?: string } }) {
  const { supabase, active, full, ar, lang } = await getPortal(params.lang);
  if (!full) redirect(`/${lang}/portal/home`);
  const { data } = await supabase.rpc("portal_plans", { p_patient: active.id });
  const plans = (data ?? []) as Plan[];
  const online = paymentsMode() !== "off";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "خطط العلاج والأقساط" : "Treatment plans & installments"}</h1>
      <Banner error={searchParams.error} success={searchParams.ok === "accepted" ? (ar ? "تم تسجيل موافقتك على الخطة. شكرًا لثقتك." : "Your acceptance is recorded. Thank you.") : undefined} />
      {plans.length === 0 && <p className="rounded-2xl border border-ivory-300/70 bg-white p-6 text-sm text-ink-500">{ar ? "لا توجد خطط علاج." : "No treatment plans."}</p>}
      {plans.map((p) => {
        const expired = p.status === "proposed" && p.valid_until != null && p.valid_until < today;
        return (
          <article key={p.id} className="space-y-4 rounded-2xl border border-ivory-300/70 bg-white p-5" data-portal-plan={p.status}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="font-medium text-navy-700">{p.title}</p>
                <p className="text-xs text-ink-500"><span className="num">{p.ref}</span> · {ar ? p.doctor_ar : p.doctor_en}</p></div>
              <span className="rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-900">{ar ? STATUS[p.status]?.[0] : STATUS[p.status]?.[1]}</span>
            </div>
            <ul className="divide-y divide-ivory-200 text-sm">
              {(p.items ?? []).map((i, k) => (
                <li key={k} className="flex justify-between py-1.5"><span>{ar ? i.service_ar : i.service_en}{i.tooth ? <span className="text-xs text-ink-500">{" — "}{ar ? "سن" : "tooth"} <span className="num">{i.tooth}</span></span> : null}{i.status === "done" ? <span className="text-xs text-ok"> · {ar ? "تم" : "done"}</span> : null}</span>
                  <span className="num">{money(i.total, lang)}</span></li>))}
              <li className="flex justify-between py-1.5 font-semibold"><span>{ar ? "الإجمالي" : "Total"}</span><span className="num">{money(p.total, lang)}</span></li>
            </ul>
            {p.status === "proposed" && (expired
              ? <p className="text-sm text-warn">{ar ? "انتهت صلاحية عرض السعر. تواصل مع العيادة لتحديثه." : "This quotation has expired. Please contact the clinic to renew it."}</p>
              : <form action={portalAcceptPlan} className="space-y-3 rounded-xl bg-ivory-50 p-4 text-sm" data-accept-plan>
                  <input type="hidden" name="lang" value={lang} /><input type="hidden" name="plan" value={p.id} />
                  {p.valid_until && <p className="text-xs text-ink-500">{ar ? "العرض ساري حتى" : "Valid until"} <span className="num">{p.valid_until}</span></p>}
                  {p.max_installments > 1 && <label className="block"><span className="label">{ar ? "طريقة السداد" : "How you will pay"}</span>
                    <select name="installments" className="input">{Array.from({ length: p.max_installments }, (_, k) => k + 1).map((n) => (
                      <option key={n} value={n}>{n === 1 ? (ar ? "دفعة واحدة" : "In full") : (ar ? `${n} أقساط شهرية × ${money(Math.floor((p.total * 100) / n) / 100, lang)}` : `${n} monthly × ${money(Math.floor((p.total * 100) / n) / 100, lang)}`)}</option>))}</select></label>}
                  <label className="flex items-start gap-2 text-xs"><input type="checkbox" required className="mt-0.5" />
                    <span>{ar ? "قرأت الخطة والسعر وأوافق عليهما. أعرف إن الطبيب ممكن يعدّل الخطة لو احتاج، وأي تعديل في السعر يحتاج موافقتي." : "I have read the plan and price and accept them. I understand the doctor may need to adjust the plan and any price change needs my agreement."}</span></label>
                  <SubmitButton pendingLabel="…">{ar ? "أوافق على الخطة" : "Accept the plan"}</SubmitButton>
                </form>)}
            {(p.installments ?? []).length > 0 && (
              <div>
                <p className="mb-1 text-sm font-medium text-navy-700">{ar ? "الأقساط" : "Installments"}</p>
                <ul className="divide-y divide-ivory-200 text-sm" data-portal-installments>
                  {(p.installments ?? []).map((i) => (
                    <li key={i.seq} className="flex justify-between py-1.5"><span>{dateTime(i.due_on, lang, { dateStyle: "medium", timeStyle: undefined })}</span>
                      <span className="num">{money(i.amount, lang)}{Number(i.paid) >= Number(i.amount) ? <span className="text-xs text-ok"> · {ar ? "مدفوع" : "paid"}</span> : Number(i.paid) > 0 ? <span className="text-xs text-ink-500"> · {ar ? "مدفوع" : "paid"} {money(i.paid, lang)}</span> : null}</span></li>))}
                </ul>
                {Number(p.due_now) > 0 && p.status !== "proposed" && (online
                  ? <form action={startPayment} className="mt-3"><input type="hidden" name="lang" value={lang} /><input type="hidden" name="plan" value={p.id} />
                      <SubmitButton pendingLabel="…" className="btn-gold" data-pay-installment>{ar ? `ادفع ${money(p.due_now, lang)} الآن` : `Pay ${money(p.due_now, lang)} now`}</SubmitButton></form>
                  : <p className="mt-2 text-xs text-ink-500">{ar ? "تقدر تدفع القسط في استقبال العيادة." : "You can pay the installment at the clinic reception."}</p>)}
              </div>)}
          </article>);
      })}
    </div>
  );
}
