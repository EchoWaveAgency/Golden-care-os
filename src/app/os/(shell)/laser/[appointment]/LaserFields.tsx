"use client";
import { useMemo, useState } from "react";

type Device = { id: string; label: string; counter: number | null; params: { wavelengths?: number[]; spot_mm?: number[]; fluence?: Record<string, [number, number]>; pulse_width_ms?: [number, number] } };
type Area = { code: string; name: string };
type Row = { area_code: string; wavelength_nm: string; fluence: string; pulse_width_ms: string; spot_mm: string; pulses: string };

// Device, per-area settings and the counter readings. Shows live whether the pulses reconcile with the counter;
// the database repeats every check when the session is signed.
export function LaserFields({ ar, devices, areas, initial }: {
  ar: boolean; devices: Device[]; areas: Area[];
  initial: { device_id: string; rows: Row[]; before: string; after: string; test_spot: boolean; test_pulses: string };
}) {
  const [deviceId, setDeviceId] = useState(initial.device_id || devices[0]?.id || "");
  const dev = useMemo(() => devices.find((d) => d.id === deviceId), [devices, deviceId]);
  const blank: Row = { area_code: areas[0]?.code ?? "", wavelength_nm: String(dev?.params.wavelengths?.[0] ?? ""), fluence: "", pulse_width_ms: "", spot_mm: String(dev?.params.spot_mm?.[0] ?? ""), pulses: "" };
  const [rows, setRows] = useState<Row[]>(initial.rows.length ? initial.rows : [blank]);
  const [before, setBefore] = useState(initial.before || (dev?.counter != null ? String(dev.counter) : ""));
  const [after, setAfter] = useState(initial.after);
  const [testSpot, setTestSpot] = useState(initial.test_spot);
  const [testPulses, setTestPulses] = useState(initial.test_pulses || "0");
  const set = (n: number, patch: Partial<Row>) => setRows((r) => r.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const sum = rows.reduce((a, r) => a + (Number(r.pulses) || 0), 0) + (testSpot ? Number(testPulses) || 0 : 0);
  const diff = before !== "" && after !== "" ? Number(after) - Number(before) : null;
  const gap = dev?.counter != null && before !== "" ? Number(before) - dev.counter : 0;
  const clean = rows.filter((r) => r.area_code && Number(r.pulses) > 0).map((r) => ({
    area_code: r.area_code, wavelength_nm: Number(r.wavelength_nm), fluence: Number(r.fluence), pulse_width_ms: r.pulse_width_ms ? Number(r.pulse_width_ms) : "",
    spot_mm: Number(r.spot_mm), pulses: Number(r.pulses),
  }));
  const range = (w: string) => dev?.params.fluence?.[w];

  return (
    <div className="space-y-4">
      <input type="hidden" name="areas" value={JSON.stringify(clean)} />
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="label" htmlFor="device_id">{ar ? "الجهاز *" : "Device *"}</label>
          <select id="device_id" name="device_id" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="input">
            {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select></div>
        {dev?.counter != null && (<>
          <div><label className="label" htmlFor="counter_before">{ar ? "العداد قبل الجلسة *" : "Counter before *"}</label>
            <input id="counter_before" name="counter_before" type="number" min="0" value={before} onChange={(e) => setBefore(e.target.value)} className="input num" /></div>
          <div><label className="label" htmlFor="counter_after">{ar ? "العداد بعد الجلسة *" : "Counter after *"}</label>
            <input id="counter_after" name="counter_after" type="number" min="0" value={after} onChange={(e) => setAfter(e.target.value)} className="input num" /></div>
        </>)}
      </div>
      {dev?.counter != null && <p className="text-xs text-ink-500">{ar ? "آخر قراءة مسجلة للجهاز:" : "Last recorded device reading:"} <span className="num">{dev.counter}</span>
        {gap > 0 && <span className="text-danger"> · {ar ? "فرق بدون جلسة سيُسجل:" : "unlogged difference that will be recorded:"} <span className="num">{gap}</span></span>}</p>}

      <div className="space-y-2">
        {rows.map((r, n) => {
          const rg = range(r.wavelength_nm);
          const outside = rg && r.fluence !== "" && (Number(r.fluence) < rg[0] || Number(r.fluence) > rg[1]);
          return (
            <div key={n} className={`grid items-end gap-2 rounded-lg border p-2 sm:grid-cols-12 ${outside ? "border-danger/40 bg-danger-50/40" : "border-ivory-200"}`}>
              <div className="sm:col-span-3"><label className="label">{ar ? "المنطقة" : "Area"}</label>
                <select value={r.area_code} onChange={(e) => set(n, { area_code: e.target.value })} className="input" data-area={n}>
                  {areas.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</select></div>
              <div className="sm:col-span-2"><label className="label">{ar ? "الطول الموجي nm" : "Wavelength nm"}</label>
                {dev?.params.wavelengths?.length
                  ? <select value={r.wavelength_nm} onChange={(e) => set(n, { wavelength_nm: e.target.value })} className="input num" data-wave={n}>
                      {dev.params.wavelengths.map((w) => <option key={w} value={w}>{w}</option>)}</select>
                  : <input type="number" value={r.wavelength_nm} onChange={(e) => set(n, { wavelength_nm: e.target.value })} className="input num" data-wave={n} />}</div>
              <div className="sm:col-span-2"><label className="label">{ar ? "الطاقة J/cm²" : "Fluence J/cm²"}{rg ? <span className="num text-ink-300"> {rg[0]}–{rg[1]}</span> : null}</label>
                <input type="number" step="0.1" min="0" value={r.fluence} onChange={(e) => set(n, { fluence: e.target.value })} className="input num" data-fluence={n} /></div>
              <div className="sm:col-span-2"><label className="label">{ar ? "البقعة mm" : "Spot mm"}</label>
                {dev?.params.spot_mm?.length
                  ? <select value={r.spot_mm} onChange={(e) => set(n, { spot_mm: e.target.value })} className="input num" data-spot={n}>
                      {dev.params.spot_mm.map((w) => <option key={w} value={w}>{w}</option>)}</select>
                  : <input type="number" step="0.1" value={r.spot_mm} onChange={(e) => set(n, { spot_mm: e.target.value })} className="input num" data-spot={n} />}</div>
              <div className="sm:col-span-1"><label className="label">{ar ? "النبضة ms" : "Pulse ms"}</label>
                <input type="number" step="0.01" min="0" value={r.pulse_width_ms} onChange={(e) => set(n, { pulse_width_ms: e.target.value })} className="input num" /></div>
              <div className="sm:col-span-1"><label className="label">{ar ? "النبضات" : "Pulses"}</label>
                <input type="number" min="0" value={r.pulses} onChange={(e) => set(n, { pulses: e.target.value })} className="input num" data-pulses={n} /></div>
              <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, i) => i !== n) : x))} className="h-10 text-sm text-danger" aria-label={ar ? "حذف المنطقة" : "Remove area"}>✕</button>
            </div>
          );
        })}
        <button type="button" onClick={() => setRows((x) => [...x, { ...blank }])} className="btn-ghost text-sm" data-add-area>{ar ? "+ منطقة" : "+ Area"}</button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="test_spot" checked={testSpot} onChange={(e) => setTestSpot(e.target.checked)} /> {ar ? "تم عمل اختبار (Test spot)" : "Test spot done"}</label>
        {testSpot && <div><label className="label" htmlFor="test_spot_pulses">{ar ? "نبضات الاختبار" : "Test pulses"}</label>
          <input id="test_spot_pulses" name="test_spot_pulses" type="number" min="0" value={testPulses} onChange={(e) => setTestPulses(e.target.value)} className="input num w-28" /></div>}
        {testSpot && <div className="flex-1"><label className="label" htmlFor="test_spot_note">{ar ? "ملاحظة الاختبار" : "Test spot note"}</label><input id="test_spot_note" name="test_spot_note" className="input" /></div>}
      </div>
      {dev?.counter != null && (
        <p className={`rounded-lg px-3 py-2 text-sm ${diff === null ? "bg-ivory-50 text-ink-500" : diff === sum ? "bg-teal-50 text-teal-900" : "bg-danger-50 text-danger"}`} data-reconcile>
          {ar ? "مجموع النبضات (المناطق + الاختبار):" : "Pulses (areas + test):"} <span className="num font-medium">{sum}</span>
          {" · "}{ar ? "فرق العداد:" : "Counter difference:"} <span className="num font-medium">{diff ?? "—"}</span>
          {diff !== null && (diff === sum ? (ar ? " ✓ مطابق" : " ✓ matches") : (ar ? " — غير مطابق، لن يُقبل التوقيع" : " — does not match; signing will be refused"))}
        </p>
      )}
    </div>
  );
}
