// Dental chart findings: labels and colours (shared by the server page and the client chart).
export const CONDITIONS: Record<string, { ar: string; en: string; fill: string; stroke?: string }> = {
  healthy: { ar: "سليم", en: "Healthy", fill: "#ffffff" },
  caries: { ar: "تسوس", en: "Caries", fill: "#f4c7c3", stroke: "#b42318" },
  filled: { ar: "حشو", en: "Filled", fill: "#c8d7ee", stroke: "#1f3b66" },
  crown: { ar: "تاج", en: "Crown", fill: "#f1dfa8", stroke: "#a0781e" },
  root_canal: { ar: "علاج عصب", en: "Root canal", fill: "#e3d4f0", stroke: "#6b3fa0" },
  implant: { ar: "زرعة", en: "Implant", fill: "#d9dde3", stroke: "#475467" },
  bridge: { ar: "جسر", en: "Bridge", fill: "#f6ead0", stroke: "#a0781e" },
  veneer: { ar: "فينير", en: "Veneer", fill: "#d6efec", stroke: "#0f5e63" },
  sealant: { ar: "سد شقوق", en: "Sealant", fill: "#e6f4f1", stroke: "#0f5e63" },
  fracture: { ar: "كسر", en: "Fracture", fill: "#fde3c8", stroke: "#c4580a" },
  mobility: { ar: "حركة", en: "Mobility", fill: "#fff3c4", stroke: "#b07d00" },
  extraction_needed: { ar: "يحتاج خلع", en: "Needs extraction", fill: "#ffffff", stroke: "#b42318" },
  missing: { ar: "مفقود", en: "Missing", fill: "#f2f2f2", stroke: "#98a2b3" },
};
