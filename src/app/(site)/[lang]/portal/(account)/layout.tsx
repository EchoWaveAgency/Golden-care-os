import type { Metadata } from "next";
import { getPortal, cardName } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { portalSignOut } from "@/app/actions/portal-auth";
import { switchPatient } from "@/app/actions/portal";
import { PortalNav } from "./PortalNav";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: { lang: Lang } }) {
  const { me, active, isSelf, full, ar, lang } = await getPortal(params.lang);
  const base = `/${lang}/portal`;
  const items = [
    { href: `${base}/home`, label: ar ? "الرئيسية" : "Overview" },
    { href: `${base}/appointments`, label: ar ? "المواعيد" : "Appointments" },
    ...(full ? [{ href: `${base}/medical`, label: ar ? "الزيارات والروشتات" : "Visits & prescriptions" },
                { href: `${base}/finance`, label: ar ? "الفواتير والمدفوعات" : "Invoices & payments" },
                { href: `${base}/plans`, label: ar ? "خطط العلاج والأقساط" : "Treatment plans" }] : []),
    { href: `${base}/support`, label: ar ? "الشكاوى والطلبات" : "Requests & complaints" },
    ...(isSelf ? [{ href: `${base}/family`, label: ar ? "العائلة والمشاركة" : "Family & sharing" },
                  { href: `${base}/profile`, label: ar ? "بياناتي" : "My details" }] : []),
  ];
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 print:p-0">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-navy-900 px-6 py-5 text-ivory-100">
        <div>
          <p className="text-xs text-gold-300">{ar ? "حساب المريض" : "Patient account"}</p>
          <p className="text-lg font-semibold">{cardName(active, lang)} <span className="num ms-1 text-xs font-normal text-ivory-300">{active.mrn}</span></p>
          {!isSelf && <p className="text-xs text-gold-300">{ar ? `تتصفح ملف أحد أفراد عائلتك بإذن مسجل${active.level === "full" ? "" : " — المواعيد فقط"}` : `Viewing a family member's file with recorded permission${active.level === "full" ? "" : " — appointments only"}`}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me.family.length > 0 && (
            <form action={switchPatient} className="flex items-center gap-2">
              <input type="hidden" name="lang" value={lang} />
              <label htmlFor="acting" className="sr-only">{ar ? "الملف" : "File"}</label>
              <select id="acting" name="patient" defaultValue={isSelf ? "" : active.id} className="rounded-lg border-0 bg-white/10 px-3 py-2 text-sm text-white">
                <option value="" className="text-ink">{ar ? "ملفي" : "My file"}</option>
                {me.family.map((f) => <option key={f.id} value={f.id} className="text-ink">{cardName(f, lang)}</option>)}
              </select>
              <button className="rounded-lg bg-gold-500 px-3 py-2 text-sm text-white hover:bg-gold-700">{ar ? "عرض" : "Open"}</button>
            </form>
          )}
          <form action={portalSignOut}>
            <input type="hidden" name="lang" value={lang} />
            <button className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10">{ar ? "خروج" : "Sign out"}</button>
          </form>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[220px_1fr] print:block">
        <PortalNav items={items} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
