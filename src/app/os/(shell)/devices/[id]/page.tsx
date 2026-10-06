import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAny } from "@/lib/session";
import { dateTime, money } from "@/lib/format";
import { ALERT, DEVICE_CATEGORY, DEVICE_STATUS, WO_KIND, WO_STATUS, label } from "@/lib/devices";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { Stat } from "@/components/Stat";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelWorkOrder, closeWorkOrder, openWorkOrder, recordReading, retireDevice } from "@/app/actions/devices";
import { recordSupplierBill } from "@/app/actions/dental";
import { DeviceForm, type DeviceRow } from "../DeviceForm";

export const dynamic = "force-dynamic";

type WO = { id: string; ref: string; vendor_id: string | null; kind: string; status: string; device_down: boolean; problem: string; reported_at: string; technician: string | null;
  parts: string | null; parts_cost: number; labor_cost: number; result: string | null; passed: boolean | null; closed_at: string | null; cancel_reason: string | null };
type Reading = { id: string; reading: number; delta: number; gap: number; source: string; note: string | null; recorded_at: string; session_id: string | null };

export default async function DevicePage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string; edit?: string } }) {
  const ctx = await requireAny("device.read", "device.manage", "device.maintain");
  const ar = ctx.locale === "ar";
  const { data: d } = await ctx.supabase.from("devices").select("*").eq("id", params.id).maybeSingle<DeviceRow>();
  if (!d) notFound();
  const [{ data: orders }, { data: readings }, { data: alerts }, { data: rooms }, { data: suppliers }, { data: sessions }] = await Promise.all([
    ctx.supabase.from("maintenance_orders").select("*").eq("device_id", d.id).order("reported_at", { ascending: false }).limit(30).returns<WO[]>(),
    ctx.supabase.from("device_counter_readings").select("id, reading, delta, gap, source, note, recorded_at, session_id").eq("device_id", d.id)
      .order("recorded_at", { ascending: false }).limit(15).returns<Reading[]>(),
    ctx.supabase.rpc("device_alerts", { p_branch: d.branch_id }),
    ctx.supabase.from("rooms").select("id, name_ar, name_en").eq("branch_id", d.branch_id).order("code"),
    ctx.supabase.from("suppliers").select("id, name_ar").eq("is_active", true).order("name_ar"),
    ctx.supabase.from("laser_sessions").select("id, ref").eq("device_id", d.id),
  ]);
  const sessionRef = new Map(((sessions ?? []) as { id: string; ref: string }[]).map((s) => [s.id, s.ref]));
  const mine = ((alerts ?? []) as { device_id: string; alert: string; detail: string | null }[]).filter((a) => a.device_id === d.id);
  const nf = new Intl.NumberFormat("en-US");
  const open = (orders ?? []).filter((o) => o.status === "open");
  const ok = {
    created: ar ? "تم تسجيل الجهاز." : "Device registered.", saved: ar ? "تم حفظ التعديلات." : "Changes saved.", retired: ar ? "تم استبعاد الجهاز." : "Device retired.",
    reading: ar ? "تم تسجيل قراءة العداد." : "Counter reading recorded.", opened: ar ? "تم فتح أمر الصيانة." : "Work order opened.",
    closed: ar ? "تم إغلاق أمر الصيانة." : "Work order closed.", bill: ar ? "تم تسجيل فاتورة الصيانة على المورد." : "Maintenance bill recorded against the vendor.", cancelled: ar ? "تم إلغاء أمر الصيانة." : "Work order cancelled.",
  }[searchParams.ok ?? ""];
  const life = d.expected_life ? Math.round((Number(d.counter_value) * 100) / Number(d.expected_life)) : null;
  const src = (s: string) => ({ initial: ar ? "عند التسجيل" : "Registration", session: ar ? "جلسة" : "Session", manual: ar ? "قراءة يدوية" : "Manual reading", service_reset: ar ? "تصفير بعد صيانة" : "Service reset" }[s] ?? s);

  return (
    <>
      <PageHeader title={ar ? d.name_ar : d.name_en}
        subtitle={[d.asset_no, label(DEVICE_CATEGORY, d.category, ar), d.manufacturer, d.model, d.serial_no ? `S/N ${d.serial_no}` : null].filter(Boolean).join(" · ")}
        actions={<>
          {ctx.can("device.manage") && d.status !== "retired" && <Link href={`/os/devices/${d.id}?edit=1`} className="btn-ghost">{ar ? "تعديل البيانات" : "Edit"}</Link>}
          <Link href="/os/devices" className="btn-ghost">{ctx.t("common.back")}</Link></>} />
      <Banner error={searchParams.error} success={ok} />
      {searchParams.edit && ctx.can("device.manage") && <section className="mb-6"><DeviceForm ar={ar} device={d} rooms={rooms ?? []} suppliers={suppliers ?? []} /></section>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={ar ? "الحالة" : "Status"} value={label(DEVICE_STATUS, d.status, ar)} tone={d.status === "active" ? "teal" : "danger"} />
        <Stat label={ar ? "العداد" : "Counter"} value={d.counter_unit ? nf.format(Number(d.counter_value)) : "—"} />
        <Stat label={ar ? "من العمر الافتراضي" : "Of rated life"} value={life !== null ? `${life}%` : "—"} tone={life !== null && life >= 90 ? "danger" : "navy"} />
        <Stat label={ar ? "الصيانة / المعايرة" : "Maintenance / calibration"} value={`${d.next_pm_due ?? "—"} · ${d.calibration_due ?? "—"}`} tone="gold" />
      </div>
      {mine.length > 0 && (
        <ul className="mb-5 space-y-1 rounded-xl border border-warn/30 bg-warn-50 p-4 text-sm">
          {mine.map((a, i) => <li key={i}>{label(ALERT, a.alert, ar)} {a.detail ? <span className="num">{a.detail}</span> : null}</li>)}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-4">
          <h2 className="font-medium text-navy-700">{ar ? "أوامر الصيانة" : "Work orders"}</h2>
          {ctx.can("device.maintain") && d.status !== "retired" && (
            <form action={openWorkOrder} className="card grid gap-3 p-4 md:grid-cols-4">
              <input type="hidden" name="device_id" value={d.id} />
              <div><label className="label" htmlFor="wo_kind">{ar ? "النوع" : "Type"}</label>
                <select id="wo_kind" name="kind" className="input">{Object.entries(WO_KIND).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}</select></div>
              <div className="md:col-span-2"><label className="label" htmlFor="wo_problem">{ar ? "المشكلة / العمل المطلوب" : "Problem / planned work"}</label>
                <input id="wo_problem" name="problem" required className="input" /></div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="device_down" /> {ar ? "إيقاف الجهاز" : "Take out of service"}</label>
              <div className="md:col-span-4"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "فتح أمر صيانة" : "Open work order"}</SubmitButton></div>
            </form>
          )}
          {open.map((o) => (
            <div key={o.id} className="card space-y-3 border-warn/40 p-4" data-open-order={o.ref}>
              <p className="text-sm"><span className="num font-medium">{o.ref}</span> · {label(WO_KIND, o.kind, ar)}{o.device_down ? <span className="text-danger"> · {ar ? "الجهاز متوقف" : "device down"}</span> : null}
                <span className="block text-ink-500">{o.problem} · {dateTime(o.reported_at, ctx.locale)}</span></p>
              {ctx.can("device.maintain") && (<>
                <form action={closeWorkOrder} className="grid gap-2 md:grid-cols-4">
                  <input type="hidden" name="device_id" value={d.id} /><input type="hidden" name="order_id" value={o.id} />
                  <div className="md:col-span-2"><label className="label">{ar ? "ما تم عمله *" : "Work done *"}</label><input name="result" required className="input" /></div>
                  <div><label className="label">{ar ? "الفني" : "Technician"}</label><input name="technician" className="input" /></div>
                  <div><label className="label">{ar ? "الوكيل" : "Vendor"}</label><select name="vendor_id" className="input"><option value="">—</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}</select></div>
                  <div><label className="label">{ar ? "قطع الغيار" : "Parts"}</label><input name="parts" className="input" /></div>
                  <div><label className="label">{ar ? "تكلفة القطع" : "Parts cost"}</label><input name="parts_cost" type="number" min="0" step="0.01" className="input num" /></div>
                  <div><label className="label">{ar ? "تكلفة العمالة" : "Labour cost"}</label><input name="labor_cost" type="number" min="0" step="0.01" className="input num" /></div>
                  {d.counter_unit && <div><label className="label">{ar ? "قراءة العداد" : "Counter reading"}</label><input name="counter_reading" type="number" min="0" className="input num" /></div>}
                  {["calibration", "safety_check"].includes(o.kind) && (
                    <div><label className="label">{ar ? "النتيجة *" : "Result *"}</label><select name="passed" required className="input"><option value="">—</option>
                      <option value="yes">{ar ? "ناجح" : "Passed"}</option><option value="no">{ar ? "غير ناجح" : "Failed"}</option></select></div>)}
                  <div className="md:col-span-4"><SubmitButton pendingLabel="…" className="btn-primary">{ar ? "إغلاق أمر الصيانة" : "Close work order"}</SubmitButton></div>
                </form>
                <form action={cancelWorkOrder} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="device_id" value={d.id} /><input type="hidden" name="order_id" value={o.id} />
                  <input name="reason" required placeholder={ar ? "سبب الإلغاء" : "Reason"} className="input w-56" />
                  <SubmitButton pendingLabel="…" className="btn-ghost text-sm">{ar ? "إلغاء" : "Cancel"}</SubmitButton>
                </form>
              </>)}
            </div>
          ))}
          <ul className="card divide-y divide-ivory-200 text-sm">
            {(orders ?? []).filter((o) => o.status !== "open").length === 0 && <li className="px-5 py-3 text-ink-300">{ctx.t("common.none")}</li>}
            {(orders ?? []).filter((o) => o.status !== "open").map((o) => (
              <li key={o.id} className="px-5 py-3">
                <span className="num font-medium">{o.ref}</span> · {label(WO_KIND, o.kind, ar)} · {label(WO_STATUS, o.status, ar)}
                {o.passed !== null && <span className={o.passed ? "text-teal-700" : "text-danger"}> · {o.passed ? (ar ? "ناجح" : "passed") : (ar ? "غير ناجح" : "failed")}</span>}
                <span className="block text-ink-500">{o.problem}{o.result ? ` → ${o.result}` : ""}{o.cancel_reason ? ` → ${o.cancel_reason}` : ""}</span>
                <span className="block text-xs text-ink-300">{dateTime(o.reported_at, ctx.locale)}{o.closed_at ? ` → ${dateTime(o.closed_at, ctx.locale)}` : ""}
                  {Number(o.parts_cost) + Number(o.labor_cost) > 0 ? <> · <span className="num">{money(Number(o.parts_cost) + Number(o.labor_cost), ctx.locale)}</span></> : null}</span>
                {o.status === "closed" && o.vendor_id && ctx.can("supplier.bill.record") && (
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-teal-700">{ar ? "تسجيل فاتورة الوكيل (مستحق للمورد)" : "Record the vendor's bill (supplier payable)"}</summary>
                    <form action={recordSupplierBill} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="kind" value="maintenance" /><input type="hidden" name="maintenance_order_id" value={o.id} />
                      <input type="hidden" name="supplier_id" value={o.vendor_id} /><input type="hidden" name="back" value={`/os/devices/${d.id}`} />
                      <input name="bill_no" required placeholder={ar ? "رقم الفاتورة" : "Invoice no."} className="input w-32 py-1 text-xs" dir="ltr" />
                      <input name="amount" type="number" min="0.01" step="0.01" required defaultValue={Number(o.parts_cost) + Number(o.labor_cost) || undefined} className="input num w-28 py-1 text-xs" />
                      <SubmitButton pendingLabel="…" className="btn-gold px-2 py-1 text-xs">{ar ? "تسجيل" : "Record"}</SubmitButton>
                    </form></details>)}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          {d.counter_unit && (<>
            <h2 className="font-medium text-navy-700">{ar ? "سجل العداد" : "Counter log"}</h2>
            {ctx.can("device.maintain") && (
              <form action={recordReading} className="card space-y-2 p-4">
                <input type="hidden" name="device_id" value={d.id} />
                <label className="label" htmlFor="reading">{ar ? "قراءة يدوية" : "Manual reading"}</label>
                <input id="reading" name="reading" type="number" min="0" required className="input num" />
                <input name="note" placeholder={ar ? "ملاحظة" : "Note"} className="input" />
                {ctx.can("device.manage") && <label className="flex items-center gap-2 text-xs text-ink-500"><input type="checkbox" name="reset" /> {ar ? "تصفير بعد تغيير قطعة (يتطلب سببًا)" : "Reset after a part change (reason required)"}</label>}
                <SubmitButton pendingLabel="…" className="btn-ghost text-sm">{ar ? "تسجيل القراءة" : "Record reading"}</SubmitButton>
              </form>
            )}
            <ul className="card divide-y divide-ivory-200 text-sm">
              {(readings ?? []).map((r) => (
                <li key={r.id} className="px-4 py-2">
                  <span className="num font-medium">{nf.format(Number(r.reading))}</span> <span className="text-ink-500">· {src(r.source)}{r.session_id ? ` ${sessionRef.get(r.session_id) ?? ""}` : ""}</span>
                  {Number(r.delta) !== 0 && <span className="num text-ink-500"> (+{nf.format(Number(r.delta))})</span>}
                  {Number(r.gap) > 0 && <span className="block text-xs text-danger">{ar ? "نبضات بدون جلسة:" : "Unlogged pulses:"} <span className="num">{nf.format(Number(r.gap))}</span></span>}
                  <span className="block text-xs text-ink-300">{dateTime(r.recorded_at, ctx.locale)}{r.note ? ` · ${r.note}` : ""}</span>
                </li>
              ))}
            </ul>
          </>)}
          <dl className="card space-y-1 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-ink-500">{ar ? "تاريخ الشراء" : "Purchased"}</dt><dd className="num">{d.purchase_date ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">{ar ? "الضمان حتى" : "Warranty until"}</dt><dd className="num">{d.warranty_until ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">{ar ? "صيانة كل" : "Service every"}</dt><dd className="num">{d.service_every ? nf.format(Number(d.service_every)) : "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">{ar ? "الصيانة التالية عند" : "Next service at"}</dt><dd className="num">{d.counter_next_service ? nf.format(Number(d.counter_next_service)) : "—"}</dd></div>
            {d.notes && <p className="whitespace-pre-line pt-2 text-ink-500">{d.notes}</p>}
          </dl>
          {ctx.can("device.manage") && d.status !== "retired" && (
            <form action={retireDevice} className="card flex flex-wrap items-center gap-2 p-4">
              <input type="hidden" name="device_id" value={d.id} />
              <input name="reason" required placeholder={ar ? "سبب الاستبعاد" : "Reason for retiring"} className="input flex-1" />
              <SubmitButton pendingLabel="…" className="btn-danger text-sm">{ar ? "استبعاد الجهاز" : "Retire"}</SubmitButton>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
