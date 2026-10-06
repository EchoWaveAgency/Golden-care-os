import { describe, expect, it } from "vitest";
import { esc, profitCsv, type ProfitRow } from "./reports";

const row: ProfitRow = { service_id: "s", service_code: "DERM-CONS", service_ar: "كشف, جلدية", service_en: "Derm \"consult\"", doctor_id: "d", doctor_ar: "د. سارة", doctor_en: "Dr. Sara",
  units: 2, gross: 1000, discounts: 100, refunds: 0, net_revenue: 900, doctor_share: 360, consumables: 40, lab_costs: 0, margin: 500 };

describe("profitability CSV", () => {
  it("starts with a BOM and escapes commas and quotes", () => {
    const csv = profitCsv([row], "ar");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"كشف, جلدية"');
    expect(profitCsv([row], "en")).toContain('"Derm ""consult"""');
  });
  it("computes margin percent", () => {
    expect(profitCsv([row], "en").split("\r\n")[1].endsWith(",55.6")).toBe(true);
  });
  it("neutralises spreadsheet formulas in text but keeps negative numbers", () => {
    expect(esc("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(esc("+1")).toBe("'+1");
    expect(esc("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(esc(-250)).toBe("-250");
    expect(esc("a\rb")).toBe('"a\rb"');
  });
});
