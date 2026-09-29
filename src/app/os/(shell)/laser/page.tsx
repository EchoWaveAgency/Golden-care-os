import Link from "next/link";
import { requireAny } from "@/lib/session";
import { dateTime, rangeStart, timeOnly } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";

export const dynamic = "force-dynamic";

type Apt = { id: string; ref: string; slot: string; status: string; patient_id: string; doctor: { full_name_ar: string; full_name_en: string | null } | null };
type Sess = { id: string; ref: string; appointment_id: string; patient_id: string; status: string; signed_at: string | null; created_at: string;
  device: { asset_no: string; name_ar: string; name_en: string } | null };

export default async function LaserPage({ searchParams }: { searchParams: { error?: string } }) {
  const ctx = await requireAny("laser.operate");
  const ar = ctx.locale === "ar";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const { data: derm } = await ctx.supabase.from("specialties").select("id").eq("code", "derm").maybeSingle();
  const [{ data: apts }, { data: sessions }] = await Promise.all([
    ctx.supabase.from("appointments").select("id, ref, slot, status, patient_id, doctor:staff(full_name_ar, full_name_en)")
      .eq("branch_id", ctx.branchId ?? "").eq("specialty_id", derm?.id ?? "")
      .overlaps("slot", `[${today}T00:00:00+03:00,${today}T23:59:59+03:00)`).not("status", "in", "(canceled,no_show)").order("slot").returns<Apt[]>(),
    ctx.supabase.from("laser_sessions").select("id, ref, appointment_id, patient_id, status, signed_at, created_at, device:devices(asset_no, name_ar, name_en)")
      .order("created_at", { ascending: false }).limit(25).returns<Sess[]>(),
  ]);
  const ids = Array.from(new Set([...(apts ?? []).map((a) => a.patient_id), ...(sessions ?? []).map((s) => s.patient_id)]));
  const { data: dir } = ids.length ? await ctx.supabase.rpc("patient_directory", { p_ids: ids }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; full_name_ar: string }[]).map((p) => [p.id, p.full_name_ar]));
  const byApt = new Map((sessions ?? []).map((s) => [s.appointment_id, s]));
  const arrived = new Set(["arrived", "waiting", "in_consultation", "procedure_in_progress", "awaiting_payment", "completed"]);

  return (
    <>
      <PageHeader title={ar ? "جلسات الليزر" : "Laser sessions"}
        subtitle={ar ? "سجل الجلسة: الجهاز والإعدادات لكل منطقة، قراءة العداد قبل وبعد، الموانع، والباقة." : "Session record: device and settings per area, counter before and after, contraindications, and the package."} />
      <Banner error={searchParams.error} />
      <section className="mb-6">
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "مواعيد الجلدية والليزر اليوم" : "Today's dermatology & laser appointments"}</h2>
        <ul className="card divide-y divide-ivory-200 text-sm">
          {(apts ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
          {(apts ?? []).map((a) => {
            const s = byApt.get(a.id);
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span><span className="num">{timeOnly(rangeStart(a.slot), ctx.locale)}</span> · {names.get(a.patient_id) ?? a.ref}
                  <span className="block text-xs text-ink-300">{a.doctor ? (ar ? a.doctor.full_name_ar : a.doctor.full_name_en ?? a.doctor.full_name_ar) : ""} · <span className="num">{a.ref}</span></span></span>
                {arrived.has(a.status) && (
                  <Link href={`/os/laser/${a.id}`} className={s?.status === "signed" ? "btn-ghost text-sm" : "btn-primary text-sm"} data-laser-apt={a.ref}>
                    {s?.status === "signed" ? (ar ? "عرض الجلسة" : "View session") : s ? (ar ? "متابعة المسودة" : "Continue draft") : (ar ? "بدء جلسة" : "Start session")}
                  </Link>
                )}
                {!arrived.has(a.status) && <span className="text-xs text-ink-300">{ar ? "بانتظار تسجيل الوصول" : "Awaiting check-in"}</span>}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium text-navy-700">{ar ? "آخر الجلسات" : "Recent sessions"}</h2>
        <ul className="card divide-y divide-ivory-200 text-sm">
          {(sessions ?? []).length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
          {(sessions ?? []).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <Link href={`/os/laser/${s.appointment_id}`} className="text-navy-700 hover:underline"><span className="num">{s.ref}</span> · {names.get(s.patient_id) ?? ""}</Link>
              <span className="text-xs text-ink-500">{s.device ? `${s.device.asset_no} · ` : ""}{s.status === "signed" ? (ar ? "موقّعة " : "Signed ") + dateTime(s.signed_at!, ctx.locale) : (ar ? "مسودة" : "Draft")}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
