import { describe, expect, it } from "vitest";
import { lastMonth, monthDays, parseDateTime, parsePunchFile } from "./hr";

describe("parseDateTime", () => {
  it("reads ISO and day-first formats", () => {
    expect(parseDateTime("2026-09-03 07:55:12")).toBe("2026-09-03 07:55:12");
    expect(parseDateTime("2026/9/3 7:05")).toBe("2026-09-03 07:05:00");
    expect(parseDateTime("03/09/2026 04:10 PM")).toBe("2026-09-03 16:10:00");
    expect(parseDateTime("03/09/2026 12:15 ص")).toBe("2026-09-03 00:15:00");
  });
  it("rejects impossible values", () => {
    expect(parseDateTime("2026-13-03 07:55")).toBeNull();
    expect(parseDateTime("hello")).toBeNull();
  });
});

describe("parsePunchFile", () => {
  it("reads a ZKTeco CSV export with a header", () => {
    const csv = "No,AC-No,Name,Time,State\n1,0077,سارة,2026-09-03 07:55:00,C/In\n2,0077,سارة,2026-09-03 16:05:00,C/Out\n3,,x,2026-09-03 09:00,C/In\n";
    const r = parsePunchFile(csv);
    expect(r.rows).toEqual([{ biometric_id: "77", at: "2026-09-03 07:55:00" }, { biometric_id: "77", at: "2026-09-03 16:05:00" }]);
    expect(r.skipped).toBe(1);
  });
  it("reads the device log format (tab separated, no header)", () => {
    const r = parsePunchFile("12\t2026-09-03 08:01:00\t0\t1\n12\t2026-09-03 16:00:00\t1\t1");
    expect(r.rows.map((x) => x.biometric_id)).toEqual(["12", "12"]);
  });
  it("reads semicolon files with day-first dates and a BOM", () => {
    const r = parsePunchFile("﻿ID;Date time\n5;03/09/2026 08:00\n5;03/09/2026 04:00 PM");
    expect(r.rows).toEqual([{ biometric_id: "5", at: "2026-09-03 08:00:00" }, { biometric_id: "5", at: "2026-09-03 16:00:00" }]);
  });
});

describe("months", () => {
  it("previous month and its days", () => {
    expect(lastMonth(new Date("2026-01-15T10:00:00Z"))).toBe("2025-12");
    expect(monthDays("2026-02")).toHaveLength(28);
  });
});

import { parseAttlog } from "./hr-device";
describe("device push (ADMS ATTLOG)", () => {
  it("reads punch lines and ignores noise", () => {
    expect(parseAttlog("0077\t2026-09-03 07:55:00\t0\t1\t0\t0\n\nbad line\n12\t2026-09-03 16:01:00\t1\t1")).toEqual([
      { biometric_id: "77", at: "2026-09-03 07:55:00" }, { biometric_id: "12", at: "2026-09-03 16:01:00" }]);
  });
});
