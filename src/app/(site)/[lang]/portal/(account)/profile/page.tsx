import { redirect } from "next/navigation";
import { getPortal, cardName } from "@/lib/portal";
import type { Lang } from "@/lib/site/api";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { portalProfile } from "@/app/actions/portal";

export default async function PortalProfile({ params, searchParams }: { params: { lang: Lang }; searchParams: { ok?: string; error?: string } }) {
  const { me, isSelf, ar, lang } = await getPortal(params.lang);
  if (!isSelf) redirect(`/${lang}/portal/home`);
  const p = me.patient;
  const whatsapp = me.consents.whatsapp_messages !== false;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-navy-700">{ar ? "بياناتي" : "My details"}</h1>
      <Banner error={searchParams.error} success={searchParams.ok ? (ar ? "تم حفظ بياناتك." : "Your details were saved.") : undefined} />
      <section className="rounded-2xl border border-ivory-300/70 bg-white p-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div><dt className="text-xs text-ink-500">{ar ? "الاسم" : "Name"}</dt><dd className="font-medium">{cardName(p, lang)}</dd></div>
          <div><dt className="text-xs text-ink-500">{ar ? "رقم الملف" : "File number"}</dt><dd className="num">{p.mrn}</dd></div>
          <div><dt className="text-xs text-ink-500">{ar ? "الموبايل" : "Mobile"}</dt><dd className="num" dir="ltr">{p.phone}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-ink-300">{ar ? "لتغيير الاسم أو رقم الموبايل تواصل مع الاستقبال (يلزم التحقق من الهوية)." : "To change your name or mobile, contact reception (identity check required)."}</p>
      </section>
      <form action={portalProfile} className="grid gap-4 rounded-2xl border border-ivory-300/70 bg-white p-5 sm:grid-cols-2">
        <input type="hidden" name="lang" value={lang} />
        <div className="sm:col-span-2"><label className="label" htmlFor="email">{ar ? "البريد الإلكتروني (اختياري)" : "Email (optional)"}</label><input id="email" name="email" type="email" defaultValue={p.email ?? ""} dir="ltr" className="input" /></div>
        <div><label className="label" htmlFor="en">{ar ? "اسم شخص للطوارئ" : "Emergency contact name"}</label><input id="en" name="emergency_name" defaultValue={p.emergency_name ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="ep">{ar ? "موبايله" : "Their mobile"}</label><input id="ep" name="emergency_phone" type="tel" defaultValue={p.emergency_phone ?? ""} dir="ltr" className="input" /></div>
        <label className="flex items-start gap-3 rounded-xl bg-ivory-50 p-4 text-sm sm:col-span-2">
          <input type="checkbox" name="whatsapp" defaultChecked={whatsapp} className="mt-1" />
          <span>{ar ? "أوافق على استلام تأكيد وتذكير المواعيد وتحديثات حسابي على واتساب." : "Send me appointment confirmations, reminders and account updates on WhatsApp."}
            <span className="block text-xs text-ink-500">{ar ? "رموز الدخول تُرسل دائمًا لأنها ضرورية لتسجيل الدخول. لا نرسل رسائل تسويقية دون موافقة منفصلة." : "Sign-in codes are always sent because they are needed to sign in. We never send marketing without separate consent."}</span></span>
        </label>
        <div className="sm:col-span-2"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "حفظ" : "Save"}</SubmitButton></div>
      </form>
    </div>
  );
}
