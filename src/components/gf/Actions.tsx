import { setLeadOutcome } from "@/app/actions/lead-flow";
import { SubmitButton } from "@/components/SubmitButton";
import { CC_STATUS, QUICK } from "@/lib/leads-flow";
import { clinicToday } from "@/lib/format";

const L = (ar: boolean, a: string, e: string) => (ar ? a : e);
const pending = (ar: boolean) => (ar ? "جارٍ الحفظ…" : "Saving…");

/** One-tap actions (no extra input): CONTACTED · INTERESTED · NO RESPONSE. */
export function QuickActions({ id, ar, back, current }: { id: string; ar: boolean; back: string; current: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {QUICK.map((s) => (
        <form key={s} action={setLeadOutcome}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={s} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton pendingLabel={pending(ar)}
            className={`gf-btn w-full px-2 text-xs ${current === s ? "bg-gold-300/20 text-gold-100 ring-1 ring-gold-300/60" : "border border-coal-500 bg-coal-900 text-ivory-100 hover:border-gold-300"}`}>
            {ar ? CC_STATUS[s].ar : CC_STATUS[s].en}
          </SubmitButton>
        </form>
      ))}
    </div>
  );
}

/** All seven actions with their forms (lead workspace). `open` re-opens the form that failed validation. */
export function FullActions({ id, ar, back, current, open, defaultService }: {
  id: string; ar: boolean; back: string; current: string; open?: string; defaultService?: string | null;
}) {
  const today = clinicToday();
  const hidden = (s: string) => (<><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={s} /><input type="hidden" name="back" value={back} /></>);
  const summary = (s: keyof typeof CC_STATUS, tone: string) => (
    <summary className={`gf-btn w-full cursor-pointer list-none text-sm ${tone}`}>{ar ? CC_STATUS[s].ar : CC_STATUS[s].en}</summary>
  );
  return (
    <div className="space-y-3">
      <QuickActions id={id} ar={ar} back={back} current={current} />
      <div className="grid gap-2 sm:grid-cols-2">
        <details data-form className="group" open={open === "follow_up"}>
          {summary("follow_up", "border border-amber-300/50 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20")}
          <form action={setLeadOutcome} className="gf-card mt-2 space-y-3 p-3">
            {hidden("follow_up")}
            <div className="grid grid-cols-2 gap-2">
              <label><span className="gf-label">{L(ar, "تاريخ المتابعة", "Follow-up date")}</span>
                <input type="date" name="fu_date" required min={today} defaultValue={today} className="gf-input num" /></label>
              <label><span className="gf-label">{L(ar, "الوقت", "Time")}</span>
                <input type="time" name="fu_time" required className="gf-input num" /></label>
            </div>
            <label className="block"><span className="gf-label">{L(ar, "السبب", "Reason")}</span>
              <select name="reason" required className="gf-input" defaultValue="">
                <option value="" disabled>{L(ar, "اختر…", "Choose…")}</option>
                {[["يفكر / يستشير", "Thinking / consulting family"], ["طلب الاتصال لاحقًا", "Asked to call later"], ["ينتظر الراتب / الميزانية", "Waiting for budget"],
                  ["يريد تفاصيل أكثر", "Wants more details"], ["لم يرد — محاولة أخرى", "No answer — try again"], ["أخرى", "Other"]].map(([a, e]) => (
                  <option key={e} value={ar ? a : e}>{ar ? a : e}</option>
                ))}
              </select></label>
            <label className="block"><span className="gf-label">{L(ar, "ملاحظات", "Notes")}</span>
              <textarea name="notes" rows={2} maxLength={2000} className="gf-input" /></label>
            <SubmitButton pendingLabel={pending(ar)} className="gf-btn-gold w-full">{L(ar, "حفظ المتابعة", "Save follow-up")}</SubmitButton>
          </form>
        </details>

        <details data-form open={open === "booked"}>
          {summary("booked", "bg-emerald-500 text-coal-950 hover:bg-emerald-400")}
          <form action={setLeadOutcome} className="gf-card mt-2 space-y-3 p-3">
            {hidden("booked")}
            <div className="grid grid-cols-2 gap-2">
              <label><span className="gf-label">{L(ar, "تاريخ الحجز", "Booking date")}</span>
                <input type="date" name="bk_date" required min={today} defaultValue={today} className="gf-input num" /></label>
              <label><span className="gf-label">{L(ar, "الوقت", "Time")}</span>
                <input type="time" name="bk_time" required className="gf-input num" /></label>
            </div>
            <label className="block"><span className="gf-label">{L(ar, "الخدمة", "Service")}</span>
              <input name="service" required maxLength={200} defaultValue={defaultService ?? ""} className="gf-input" /></label>
            <label className="block"><span className="gf-label">{L(ar, "ملاحظات الحجز", "Booking notes")}</span>
              <textarea name="notes" rows={2} maxLength={2000} className="gf-input" /></label>
            <SubmitButton pendingLabel={pending(ar)} className="gf-btn w-full bg-emerald-500 text-coal-950 hover:bg-emerald-400">{L(ar, "تأكيد الحجز", "Confirm booking")}</SubmitButton>
          </form>
        </details>

        {(["not_interested", "closed"] as const).map((s) => (
          <details data-form key={s} open={open === s}>
            {summary(s, "border border-coal-500 bg-coal-900 text-ivory-300 hover:border-ivory-300")}
            <form action={setLeadOutcome} className="gf-card mt-2 space-y-3 p-3">
              {hidden(s)}
              <label className="block"><span className="gf-label">{L(ar, "السبب", "Reason")}</span>
                <select name="reason" required className="gf-input" defaultValue="">
                  <option value="" disabled>{L(ar, "اختر…", "Choose…")}</option>
                  {(s === "not_interested"
                    ? [["السعر", "Price"], ["المكان بعيد", "Location"], ["اختار مكانًا آخر", "Chose another clinic"], ["كان يسأل فقط", "Just asking"], ["أخرى", "Other"]]
                    : [["رقم خطأ", "Wrong number"], ["مكرر", "Duplicate"], ["ليس عميلًا (مورد / وظيفة)", "Not a customer (vendor / job)"], ["لا يرد بعد عدة محاولات", "Unreachable after several attempts"], ["أخرى", "Other"]]
                  ).map(([a, e]) => <option key={e} value={ar ? a : e}>{ar ? a : e}</option>)}
                </select></label>
              <label className="block"><span className="gf-label">{L(ar, "ملاحظات", "Notes")}</span>
                <textarea name="notes" rows={2} maxLength={2000} className="gf-input" /></label>
              <SubmitButton pendingLabel={pending(ar)} className="gf-btn-ghost w-full">{L(ar, "حفظ", "Save")}</SubmitButton>
            </form>
          </details>
        ))}
      </div>
    </div>
  );
}
