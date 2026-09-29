import Link from "next/link";
import { requireAny } from "@/lib/session";
import { monthRange } from "@/lib/reports";
import { ALERT, DEVICE_CATEGORY, DEVICE_STATUS, label } from "@/lib/devices";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { DeviceForm } from "./DeviceForm";

export const dynamic = "force-dynamic";

type Usage = { device_id: string; sessions: number; pulses: number; unlogged: number; downtime_hours: number; work_orders: number; maintenance_cost: number };

export default async function DevicesPage({ searchParams }: { searchParams: { new?: string; error?: string } }) {
  const ctx = await requireAny("device.read", "device.manage", "device.maintain");
  const ar = ctx.locale === "ar";
  const { from, to } = monthRange();
  const [{ data: devices }, { data: alerts }, { data: usage }, { data: rooms }, { data: suppliers }] = await Promise.all([
    ctx.supabase.from("devices").select("id, asset_no, name_ar, name_en, category, model, status, counter_unit, counter_value, next_pm_due, calibration_due, room:rooms(name_ar, name_en)")
      .order("status").order("asset_no"),
    ctx.supabase.rpc("device_alerts", { p_branch: null }),
    ctx.supabase.rpc("device_usage", { p_from: from, p_to: to, p_branch: null }),
    ctx.supabase.from("rooms").select("id, name_ar, name_en").eq("branch_id", ctx.branchId ?? "").eq("is_active", true).order("code"),
    ctx.supabase.from("suppliers").select("id, name_ar").eq("is_active", true).order("name_ar"),
  ]);
  const list = (devices ?? []) as unknown as { id: string; asset_no: string; name_ar: string; name_en: string; category: string; model: string | null; status: string;
    counter_unit: string | null; counter_value: number; next_pm_due: string | null; calibration_due: string | null; room: { name_ar: string; name_en: string } | null }[];
  const al = (alerts ?? []) as { device_id: string; asset_no: string; name_ar: string; name_en: string; alert: string; detail: string | null }[];
  const us = new Map(((usage ?? []) as Usage[]).map((u) => [u.device_id, u]));
  const down = list.filter((d) => d.status === "down").length;
  const pulses = Array.from(us.values()).reduce((a, u) => a + Number(u.pulses), 0);
  const cost = Array.from(us.values()).reduce((a, u) => a + Number(u.maintenance_cost), 0);
  const nf = new Intl.NumberFormat("en-US");

  return (
    <>
      <PageHeader title={ar ? "الأجهزة والصيانة" : "Devices & maintenance"}
        subtitle={ar ? "سجل الأصول، عدادات النبضات، أوامر الصيانة، المعايرة والتنبيهات." : "Asset register, pulse counters, work orders, calibration and alerts."}
        actions={ctx.can("device.manage") ? <Link href="/os/devices?new=1" className="btn-primary">{ar ? "تسجيل جهاز" : "Register device"}</Link> : undefined} />
      <Banner error={searchParams.error} />
      {searchParams.new && ctx.can("device.manage") && (
        <section className="mb-6"><DeviceForm ar={ar} rooms={rooms ?? []} suppliers={suppliers ?? []} /></section>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "الأجهزة" : "Devices"} value={list.filter((d) => d.status !== "retired").length} />
        <Stat label={ar ? "متوقف الآن" : "Out of service"} value={down} tone={down ? "danger" : "teal"} />
        <Stat label={ar ? "نبضات هذا الشهر" : "Pulses this month"} value={nf.format(pulses)} tone="teal" />
        <Stat label={ar ? "تكلفة الصيانة هذا الشهر" : "Maintenance cost this month"} value={nf.format(cost)} tone="gold" />
      </div>
      {al.length > 0 && (
        <section className="mb-6 rounded-xl border border-warn/30 bg-warn-50 p-4">
          <h2 className="mb-2 text-sm font-medium text-navy-700">{ar ? "تنبيهات" : "Alerts"}</h2>
          <ul className="space-y-1 text-sm">
            {al.map((a, i) => (
              <li key={i}><Link href={`/os/devices/${a.device_id}`} className="font-medium text-navy-700 hover:underline"><span className="num">{a.asset_no}</span> {ar ? a.name_ar : a.name_en}</Link>
                {" — "}{label(ALERT, a.alert, ar)}{a.detail ? <> <span className="num">{a.detail}</span></> : null}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-ivory-200 bg-ivory-50"><tr>
            <th className="th">{ar ? "الجهاز" : "Device"}</th><th className="th">{ar ? "الغرفة" : "Room"}</th><th className="th">{ar ? "الحالة" : "Status"}</th>
            <th className="th">{ar ? "العداد" : "Counter"}</th><th className="th">{ar ? "جلسات / نبضات الشهر" : "Sessions / pulses (month)"}</th>
            <th className="th">{ar ? "الصيانة القادمة" : "Next maintenance"}</th><th className="th">{ar ? "المعايرة" : "Calibration"}</th></tr></thead>
          <tbody className="divide-y divide-ivory-200">
            {list.length === 0 && <tr><td className="td text-ink-300" colSpan={7}>{ctx.t("common.none")}</td></tr>}
            {list.map((d) => {
              const u = us.get(d.id);
              return (
                <tr key={d.id} className="hover:bg-ivory-50">
                  <td className="td"><Link href={`/os/devices/${d.id}`} className="font-medium text-navy-700 hover:underline">{ar ? d.name_ar : d.name_en}</Link>
                    <span className="block text-xs text-ink-300"><span className="num">{d.asset_no}</span> · {label(DEVICE_CATEGORY, d.category, ar)}{d.model ? ` · ${d.model}` : ""}</span></td>
                  <td className="td">{d.room ? (ar ? d.room.name_ar : d.room.name_en) : "—"}</td>
                  <td className="td"><span className={d.status === "active" ? "text-teal-700" : d.status === "down" ? "font-medium text-danger" : "text-ink-300"}>{label(DEVICE_STATUS, d.status, ar)}</span></td>
                  <td className="td num">{d.counter_unit ? nf.format(Number(d.counter_value)) : "—"}</td>
                  <td className="td num">{u ? `${u.sessions} / ${nf.format(Number(u.pulses))}` : "—"}</td>
                  <td className="td num">{d.next_pm_due ?? "—"}</td>
                  <td className="td num">{d.calibration_due ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
