import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPortal, cardName, type PortalMedical } from "@/lib/portal";
import { getSite, setting, type Lang } from "@/lib/site/api";
import { RxSheet } from "@/components/RxSheet";
import { PrintButton } from "@/components/PrintButton";

export default async function PortalRxPrint({ params }: { params: { lang: Lang; id: string } }) {
  const { supabase, active, full, ar, lang } = await getPortal(params.lang);
  if (!full) redirect(`/${lang}/portal/home`);
  const { data } = await supabase.rpc("portal_medical", { p_patient: active.id });
  const m = data as PortalMedical | null;
  const r = m?.prescriptions.find((x) => x.id === params.id);
  if (!m || !r) notFound();
  const site = await getSite().catch(() => ({}));
  return (
    <div>
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/${lang}/portal/medical`} className="text-sm text-teal-700 hover:underline">{ar ? "→ رجوع" : "← Back"}</Link>
        <PrintButton label={ar ? "طباعة" : "Print"} />
      </div>
      <div className="rounded-2xl border border-ivory-300/70 print:border-0">
        <RxSheet lang={lang} rxRef={r.ref} date={r.date} patientName={cardName(active, lang)} mrn={active.mrn}
          doctorName={ar ? r.doctor_ar : r.doctor_en} specialty="" notes={r.notes} allergies={m.allergies} items={r.items}
          address={setting(site, "address", lang)} />
      </div>
    </div>
  );
}
