import { describe, expect, it } from "vitest";
import { isTooth, splitInstallments } from "./dental";

const sum = (r: { amount: number }[]) => Math.round(r.reduce((a, x) => a + x.amount * 100, 0)) / 100;

describe("installment schedule", () => {
  it("down payment today, then monthly installments that add up exactly", () => {
    const r = splitInstallments(7100, 3000, 3, "2026-10-06");
    expect(r[0]).toEqual({ due_on: "2026-10-06", amount: 3000 });
    expect(r.map((x) => x.due_on)).toEqual(["2026-10-06", "2026-11-06", "2026-12-06", "2027-01-06"]);
    expect(sum(r)).toBe(7100);
  });
  it("rounding goes to the last installment", () => {
    const r = splitInstallments(1000, 0, 3, "2026-10-06");
    expect(r.map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
  });
  it("month ends are clamped (31 Jan → 28 Feb)", () => {
    expect(splitInstallments(200, 0, 1, "2027-01-31")[0].due_on).toBe("2027-02-28");
  });
  it("no installments → one payment today", () => {
    expect(splitInstallments(500, 0, 0, "2026-10-06")).toEqual([{ due_on: "2026-10-06", amount: 500 }]);
  });
});

describe("FDI tooth numbers", () => {
  it("accepts permanent and primary teeth only", () => {
    expect(["11", "18", "36", "48", "51", "85"].every(isTooth)).toBe(true);
    expect(["19", "49", "56", "90", "1", "x"].some(isTooth)).toBe(false);
  });
});
