import Link from "next/link";
import { requireAny } from "@/lib/session";
import { clinicToday, dateTime, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { recordClearingSettlement, saveLoyaltySettings } from "@/app/actions/loyalty";

export const metadata = { title: "Settlements & loyalty" };
export const dynamic = "force-dynamic";

const KEYS: Record<string, [string, string]> = {
  card_clearing: ["ماكينات البطاقات (POS)", "Card terminals (POS)"], gateway_clearing: ["الدفع الإلكتروني (البوابة)", "Online gateway"],
  instapay_clearing: ["إنستاباي", "InstaPay"], wallet_clearing: ["المحافظ الإلكترونية", "Mobile wallets"],
};

export default async function ClearingPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const ctx = await requireAny("accounting.read", "accounting.post", "accounting.configure");
  const ar = ctx.locale === "ar";
  const [{ data: bal }, { data: rows }, { data: loy }] = await Promise.all([
    ctx.supabase.rpc("clearing_balances", { p_branch: ctx.branchId }),
    ctx.supabase.from("clearing_settlements").select("id, ref, clearing_key, settled_on, gross, fees, net, reference").order("created_at", { ascending: false }).limit(20),
    ctx.supabase.from("loyalty_settings").select("*").maybeSingle(),
  ]);
  const balances = (bal ?? []) as { clearing_key: string; balance: number }[];
  const ok = { settled: ar ? "تم تسجيل التسوية: البنك بالصافي والعمولة مصروف." : "Settlement recorded: bank at net, fees expensed.", loyalty_saved: ar ? "تم حفظ إعدادات الولاء." : "Loyalty settings saved." }[searchParams.ok ?? ""];
  return (
    <>
      <PageHeader title={ar ? "تسويات البطاقات والدفع الإلكتروني · برنامج الولاء" : "Card & online settlements · Loyalty"}
        subtitle={ar ? "مدفوعات البطاقة والإنستاباي والمحافظ والدفع الإلكتروني تنتظر في حسابات وسيطة حتى يصل المبلغ للبنك. سجّل كل إيداع بالإجمالي والعمولة." : "Card, InstaPay, wallet and online payments wait in clearing accounts until the bank receives them. Record each deposit with its gross and fees."}
        actions={<Link href="/os/accounting" className="btn-ghost">{ar ? "الحسابات" : "Accounting"}</Link>} />
      <Banner error={searchParams.error} success={ok} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" data-clearing-balances>
        {balances.map((b) => <Stat key={b.clearing_key} label={ar ? KEYS[b.clearing_key][0] : KEYS[b.clearing_key][1]} value={money(b.balance, ctx.locale)} tone={Number(b.balance) > 0 ? "gold" : "teal"} />)}
      </div>
      {ctx.can("accounting.post") && (
        <form action={recordClearingSettlement} className="card mb-6 grid gap-3 p-5 text-sm md:grid-cols-6" data-clearing-form>
          <label className="md:col-span-2"><span className="label">{ar ? "الحساب الوسيط" : "Clearing account"}</span>
            <select name="key" className="input">{Object.entries(KEYS).map(([k, v]) => <option key={k} value={k}>{ar ? v[0] : v[1]}</option>)}</select></label>
          <label><span className="label">{ar ? "تاريخ الإيداع" : "Deposit date"}</span><input name="date" type="date" defaultValue={clinicToday()} max={clinicToday()} className="input" /></label>
          <label><span className="label">{ar ? "الإجمالي" : "Gross"}</span><input name="gross" type="number" min="0.01" step="0.01" required className="input num" /></label>
          <label><span className="label">{ar ? "العمولة" : "Fees"}</span><input name="fees" type="number" min="0" step="0.01" defaultValue={0} className="input num" /></label>
          <label><span className="label">{ar ? "مرجع كشف البنك" : "Bank reference"}</span><input name="reference" required className="input" dir="ltr" /></label>
          <div className="md:col-span-6"><SubmitButton pendingLabel="…">{ar ? "تسجيل التسوية" : "Record settlement"}</SubmitButton></div>
        </form>)}
      <ul className="card mb-8 divide-y divide-ivory-200 text-sm">
        {(rows ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
        {(rows ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap justify-between gap-2 px-5 py-2.5">
            <span><span className="num font-medium">{r.ref}</span> · {ar ? KEYS[r.clearing_key][0] : KEYS[r.clearing_key][1]} · <span className="num">{r.reference}</span> · {dateTime(r.settled_on, ctx.locale, { timeStyle: undefined })}</span>
            <span className="num">{money(r.gross, ctx.locale)} − {money(r.fees, ctx.locale)} = <span className="font-semibold">{money(r.net, ctx.locale)}</span></span>
          </li>))}
      </ul>

      <section className="card p-5 text-sm" data-loyalty-settings>
        <h2 className="mb-1 font-medium text-navy-700">{ar ? "برنامج الولاء والدعوات" : "Loyalty and referral programme"}</h2>
        <p className="mb-3 text-ink-500">{ar ? "متوقف حتى تحدد الإدارة القواعد. النقاط تُكسب على المدفوع فعلًا، وتُخصم عند الاسترداد، وتُستخدم كخصم على الفاتورة (قيد: خصومات برنامج الولاء)." : "Off until management sets the rules. Points are earned on money actually paid, taken back on refunds and redeemed as a discount on the invoice (posted to loyalty redemptions)."}</p>
        {ctx.can("accounting.configure") ? (
          <form action={saveLoyaltySettings} className="grid gap-3 md:grid-cols-4">
            <label className="flex items-center gap-2 md:col-span-4"><input type="checkbox" name="enabled" defaultChecked={loy?.enabled ?? false} />{ar ? "تشغيل البرنامج" : "Programme on"}</label>
            <label><span className="label">{ar ? "نقاط لكل 1 ج.م مدفوع" : "Points per 1 EGP paid"}</span><input name="points_per_egp" type="number" min="0" step="0.0001" defaultValue={loy?.points_per_egp ?? ""} className="input num" /></label>
            <label><span className="label">{ar ? "قيمة النقطة (ج.م)" : "Value of a point (EGP)"}</span><input name="egp_per_point" type="number" min="0" step="0.0001" defaultValue={loy?.egp_per_point ?? ""} className="input num" /></label>
            <label><span className="label">{ar ? "أقل عدد نقاط للاستخدام" : "Minimum points to redeem"}</span><input name="min_redeem_points" type="number" min="0" step="1" defaultValue={loy?.min_redeem_points ?? 0} className="input num" /></label>
            <label><span className="label">{ar ? "أقصى نسبة من الفاتورة (%)" : "Max share of an invoice (%)"}</span><input name="max_redeem_percent" type="number" min="0" max="100" step="0.01" defaultValue={loy?.max_redeem_percent ?? 100} className="input num" /></label>
            <label><span className="label">{ar ? "تنتهي بعد شهور بدون نشاط" : "Expire after months without activity"}</span><input name="expiry_months" type="number" min="1" step="1" defaultValue={loy?.expiry_months ?? ""} placeholder={ar ? "فارغ = لا تنتهي" : "empty = never"} className="input num" /></label>
            <label><span className="label">{ar ? "نقاط مكافأة الدعوة" : "Referral bonus points"}</span><input name="referral_bonus_points" type="number" min="1" step="1" defaultValue={loy?.referral_bonus_points ?? ""} placeholder={ar ? "فارغ = بدون" : "empty = none"} className="input num" /></label>
            <div className="flex items-end md:col-span-2"><SubmitButton pendingLabel="…">{ar ? "حفظ" : "Save"}</SubmitButton></div>
          </form>
        ) : <p className="text-ink-500">{loy?.enabled ? (ar ? "البرنامج يعمل." : "The programme is on.") : (ar ? "البرنامج متوقف." : "The programme is off.")}</p>}
      </section>
    </>
  );
}
