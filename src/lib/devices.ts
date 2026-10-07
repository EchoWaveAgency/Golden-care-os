// Labels and small helpers for devices, laser sessions and packages (bilingual).

type L = { ar: string; en: string };
const pick = (m: Record<string, L>, k: string, ar: boolean) => (m[k] ? (ar ? m[k].ar : m[k].en) : k);

export const DEVICE_CATEGORY: Record<string, L> = {
  laser: { ar: "ليزر", en: "Laser" }, ipl: { ar: "IPL", en: "IPL" }, rf: { ar: "ترددات راديوية", en: "Radio-frequency" },
  energy_other: { ar: "أجهزة طاقة أخرى", en: "Other energy device" }, dental: { ar: "أسنان", en: "Dental" },
  imaging: { ar: "أشعة وتصوير", en: "Imaging" }, sterilization: { ar: "تعقيم", en: "Sterilisation" }, other: { ar: "أخرى", en: "Other" },
};
export const DEVICE_STATUS: Record<string, L> = {
  active: { ar: "في الخدمة", en: "In service" }, down: { ar: "متوقف", en: "Out of service" }, retired: { ar: "مُستبعد", en: "Retired" },
};
export const WO_KIND: Record<string, L> = {
  preventive: { ar: "صيانة وقائية", en: "Preventive maintenance" }, breakdown: { ar: "عطل", en: "Breakdown" },
  calibration: { ar: "معايرة", en: "Calibration" }, safety_check: { ar: "فحص سلامة", en: "Safety check" },
};
export const WO_STATUS: Record<string, L> = {
  open: { ar: "مفتوح", en: "Open" }, closed: { ar: "مغلق", en: "Closed" }, cancelled: { ar: "ملغي", en: "Cancelled" },
};
export const ALERT: Record<string, L> = {
  down: { ar: "الجهاز متوقف", en: "Out of service" },
  pm_overdue: { ar: "الصيانة الوقائية متأخرة منذ", en: "Preventive maintenance overdue since" },
  pm_due_soon: { ar: "صيانة وقائية مستحقة في", en: "Preventive maintenance due" },
  calibration_overdue: { ar: "المعايرة متأخرة منذ", en: "Calibration overdue since" },
  calibration_due_soon: { ar: "معايرة مستحقة في", en: "Calibration due" },
  service_counter: { ar: "بلغ العداد حد الصيانة", en: "Counter reached the service limit" },
  end_of_life: { ar: "اقترب من نهاية العمر الافتراضي (%)", en: "Near end of rated life (%)" },
  warranty_ending: { ar: "الضمان ينتهي في", en: "Warranty ends" },
  unlogged_use: { ar: "نبضات بدون جلسة مسجلة (30 يومًا)", en: "Pulses with no recorded session (30 days)" },
};
export const REACTION: Record<string, L> = {
  none: { ar: "لا يوجد", en: "None" }, erythema: { ar: "احمرار", en: "Erythema" }, edema: { ar: "تورم", en: "Oedema" },
  perifollicular_edema: { ar: "تورم حول البصيلات (متوقع)", en: "Perifollicular oedema (expected)" }, blister: { ar: "فقاعات", en: "Blister" },
  burn: { ar: "حرق", en: "Burn" }, pigment_change: { ar: "تغير في التصبغ", en: "Pigment change" }, other: { ar: "أخرى", en: "Other" },
};
export const PACKAGE_STATUS: Record<string, L> = {
  active: { ar: "سارية", en: "Active" }, used: { ar: "مستهلكة", en: "Used up" }, expired: { ar: "منتهية", en: "Expired" }, cancelled: { ar: "ملغاة", en: "Cancelled" },
  refunded: { ar: "مستردة", en: "Refunded" },
};
export const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"];

export const label = pick;

export type DeviceParams = { wavelengths?: number[]; spot_mm?: number[]; fluence?: Record<string, [number, number]>; pulse_width_ms?: [number, number] };

const nums = (s: string) => s.split(/[,\s،]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
const range = (s: string): [number, number] | null => {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** Parse the device parameter fields of the device form. Empty fields leave that parameter unrestricted. */
export function parseParams(f: { wavelengths?: string; spots?: string; fluence?: string; pulse?: string }): DeviceParams {
  const p: DeviceParams = {};
  if (f.wavelengths?.trim()) p.wavelengths = nums(f.wavelengths);
  if (f.spots?.trim()) p.spot_mm = nums(f.spots);
  if (f.fluence?.trim()) {
    p.fluence = {};
    for (const part of f.fluence.split(/[;,،]+/)) {
      const m = part.trim().match(/^(\d+)\s*:\s*(.+)$/);
      const r = m ? range(m[2]) : null;
      if (m && r) p.fluence[m[1]] = r;
    }
  }
  if (f.pulse?.trim()) { const r = range(f.pulse); if (r) p.pulse_width_ms = r; }
  return p;
}

export function paramsToFields(p: DeviceParams | null | undefined) {
  return {
    wavelengths: (p?.wavelengths ?? []).join(", "),
    spots: (p?.spot_mm ?? []).join(", "),
    fluence: Object.entries(p?.fluence ?? {}).map(([w, [a, b]]) => `${w}:${a}-${b}`).join("; "),
    pulse: p?.pulse_width_ms ? `${p.pulse_width_ms[0]}-${p.pulse_width_ms[1]}` : "",
  };
}

export type PackageBalance = { id: string; ref: string; name_ar: string; name_en: string; service_id: string; units_total: number; units_used: number;
  value_total: number; value_used: number; expires_on: string; status: string; invoice_id: string; invoice_no: string | null; paid: boolean;
  branch_limit: string | null; sold_at: string };
