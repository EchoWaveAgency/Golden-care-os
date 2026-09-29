import { SubmitButton } from "@/components/SubmitButton";
import { saveDevice } from "@/app/actions/devices";
import { DEVICE_CATEGORY, paramsToFields, type DeviceParams } from "@/lib/devices";

export type DeviceRow = {
  id: string; asset_no: string; branch_id: string; room_id: string | null; name_ar: string; name_en: string; category: string;
  manufacturer: string | null; model: string | null; serial_no: string | null; supplier_id: string | null; purchase_date: string | null;
  purchase_cost: number | null; warranty_until: string | null; status: string; counter_unit: string | null; counter_value: number;
  expected_life: number | null; service_every: number | null; counter_next_service: number | null; pm_interval_days: number | null;
  next_pm_due: string | null; calibration_interval_days: number | null; calibration_due: string | null; params: DeviceParams; notes: string | null;
};

// Registration / configuration form. The counter can only be set at registration; afterwards it moves through
// sessions and readings.
export function DeviceForm({ ar, device, rooms, suppliers }: {
  ar: boolean; device?: DeviceRow; rooms: { id: string; name_ar: string; name_en: string }[]; suppliers: { id: string; name_ar: string }[];
}) {
  const p = paramsToFields(device?.params);
  const F = ({ name, label, type = "text", dir, def, required }: { name: string; label: string; type?: string; dir?: "ltr"; def?: string | number | null; required?: boolean }) => (
    <div><label className="label" htmlFor={`d_${name}`}>{label}</label>
      <input id={`d_${name}`} name={name} type={type} defaultValue={def ?? ""} className={`input ${type === "number" ? "num" : ""}`} dir={dir} required={required} step={type === "number" ? "any" : undefined} /></div>
  );
  return (
    <form action={saveDevice} className="card grid gap-4 p-5 md:grid-cols-3">
      <input type="hidden" name="id" value={device?.id ?? ""} />
      <F name="asset_no" label={ar ? "رقم الأصل *" : "Asset no. *"} dir="ltr" def={device?.asset_no} required />
      <F name="name_ar" label={ar ? "الاسم بالعربية *" : "Arabic name *"} def={device?.name_ar} required />
      <F name="name_en" label={ar ? "الاسم بالإنجليزية" : "English name"} dir="ltr" def={device?.name_en} />
      <div><label className="label" htmlFor="d_category">{ar ? "النوع" : "Category"}</label>
        <select id="d_category" name="category" defaultValue={device?.category ?? "laser"} className="input">
          {Object.entries(DEVICE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{ar ? v.ar : v.en}</option>)}
        </select></div>
      <div><label className="label" htmlFor="d_room">{ar ? "الغرفة" : "Room"}</label>
        <select id="d_room" name="room_id" defaultValue={device?.room_id ?? ""} className="input"><option value="">—</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{ar ? r.name_ar : r.name_en}</option>)}</select></div>
      <div><label className="label" htmlFor="d_supplier">{ar ? "المورد / الوكيل" : "Supplier / agent"}</label>
        <select id="d_supplier" name="supplier_id" defaultValue={device?.supplier_id ?? ""} className="input"><option value="">—</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name_ar}</option>)}</select></div>
      <F name="manufacturer" label={ar ? "الشركة المصنعة" : "Manufacturer"} dir="ltr" def={device?.manufacturer} />
      <F name="model" label={ar ? "الموديل" : "Model"} dir="ltr" def={device?.model} />
      <F name="serial_no" label={ar ? "الرقم التسلسلي" : "Serial no."} dir="ltr" def={device?.serial_no} />
      <F name="purchase_date" label={ar ? "تاريخ الشراء" : "Purchase date"} type="date" def={device?.purchase_date} />
      <F name="purchase_cost" label={ar ? "تكلفة الشراء" : "Purchase cost"} type="number" def={device?.purchase_cost} />
      <F name="warranty_until" label={ar ? "الضمان حتى" : "Warranty until"} type="date" def={device?.warranty_until} />
      <div><label className="label" htmlFor="d_unit">{ar ? "العداد" : "Usage counter"}</label>
        <select id="d_unit" name="counter_unit" defaultValue={device?.counter_unit ?? ""} className="input" disabled={Boolean(device)}>
          <option value="">{ar ? "بدون عداد" : "No counter"}</option><option value="pulses">{ar ? "نبضات" : "Pulses"}</option>
          <option value="shots">{ar ? "طلقات" : "Shots"}</option><option value="hours">{ar ? "ساعات تشغيل" : "Operating hours"}</option></select></div>
      {!device && <F name="counter_value" label={ar ? "قراءة العداد الحالية" : "Current counter reading"} type="number" def={0} />}
      <F name="expected_life" label={ar ? "العمر الافتراضي (بوحدة العداد)" : "Rated life (counter units)"} type="number" def={device?.expected_life} />
      <F name="service_every" label={ar ? "صيانة كل (بوحدة العداد)" : "Service every (counter units)"} type="number" def={device?.service_every} />
      <F name="pm_interval_days" label={ar ? "الصيانة الوقائية كل (يوم)" : "Preventive maintenance every (days)"} type="number" def={device?.pm_interval_days} />
      <F name="calibration_interval_days" label={ar ? "المعايرة كل (يوم)" : "Calibration every (days)"} type="number" def={device?.calibration_interval_days} />
      <fieldset className="rounded-lg border border-ivory-200 p-3 md:col-span-3">
        <legend className="px-1 text-sm font-medium text-navy-700">{ar ? "إعدادات العلاج المعتمدة (فارغ = بدون قيد)" : "Approved treatment settings (empty = not restricted)"}</legend>
        <div className="grid gap-3 md:grid-cols-4">
          <F name="p_wavelengths" label={ar ? "الأطوال الموجية (نانومتر)" : "Wavelengths (nm)"} dir="ltr" def={p.wavelengths} />
          <F name="p_spots" label={ar ? "أحجام البقعة (مم)" : "Spot sizes (mm)"} dir="ltr" def={p.spots} />
          <F name="p_fluence" label={ar ? "الطاقة J/cm² لكل طول موجي" : "Fluence J/cm² per wavelength"} dir="ltr" def={p.fluence} />
          <F name="p_pulse" label={ar ? "عرض النبضة (مللي ثانية)" : "Pulse width (ms)"} dir="ltr" def={p.pulse} />
        </div>
        <p className="mt-2 text-xs text-ink-300" dir="ltr">755, 1064 · 6, 8, 10, 12, 15, 18 · 755:2-50; 1064:2-300 · 0.35-300</p>
      </fieldset>
      <div className="md:col-span-3"><label className="label" htmlFor="d_notes">{ar ? "ملاحظات / عقود ومستندات" : "Notes / contracts and documents"}</label>
        <textarea id="d_notes" name="notes" defaultValue={device?.notes ?? ""} className="input min-h-16" /></div>
      <div className="md:col-span-3"><SubmitButton pendingLabel="…" className="btn-primary">{device ? (ar ? "حفظ التعديلات" : "Save changes") : (ar ? "تسجيل الجهاز" : "Register device")}</SubmitButton></div>
    </form>
  );
}
