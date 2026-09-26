import { describe, expect, it } from "vitest";
import { normalizeName, normalizePhone, classifySearch } from "./normalize";
import { clinicLocalToIso, clinicOffset, rangeStart, slotRange, toWesternDigits, money } from "./format";
import { navFor, homeFor, canAccess } from "./nav";
import { friendlyError } from "./errors";
import { NEXT_STATUS, APPOINTMENT_STATUSES, primaryAction } from "./appointments";
import { translator } from "./i18n";

describe("normalization mirrors the database", () => {
  it("normalizes Arabic names", () => {
    expect(normalizeName("أحمد  إبراهيم")).toBe("احمد ابراهيم");
    expect(normalizeName("فاطِمَة")).toBe("فاطمه");
    expect(normalizeName("مصطفى")).toBe("مصطفي");
  });
  it("normalizes Egyptian phones", () => {
    expect(normalizePhone("0100 123 4567")).toBe("+201001234567");
    expect(normalizePhone("٠١٢٢٣٤٥٦٧٨٩")).toBe("+201223456789");
    expect(normalizePhone("00201001234567")).toBe("+201001234567");
    expect(normalizePhone("abc")).toBeNull();
  });
  it("classifies searches", () => {
    expect(classifySearch("p-12")).toEqual({ kind: "mrn", value: "P-000012" });
    expect(classifySearch("01001234567")).toEqual({ kind: "phone", value: "+201001234567" });
    expect(classifySearch("4567")).toEqual({ kind: "phone", value: "4567" });
    expect(classifySearch("أحمد")).toEqual({ kind: "name", value: "احمد" });
    expect(classifySearch("  ")).toEqual({ kind: "none" });
  });
});

describe("clinic time", () => {
  it("converts Arabic digits", () => expect(toWesternDigits("٢٠٢٦")).toBe("2026"));
  it("handles Cairo offset", () => {
    expect(clinicOffset(new Date("2026-01-15T10:00:00Z"))).toBe("+02:00");
    expect(clinicLocalToIso("2026-01-15", "09:30")).toBe("2026-01-15T07:30:00.000Z");
  });
  it("builds and parses tstzrange", () => {
    expect(slotRange("2026-01-15T07:30:00.000Z", 15)).toBe("[2026-01-15T07:30:00.000Z,2026-01-15T07:45:00.000Z)");
    expect(rangeStart('["2026-01-15 07:30:00+00","2026-01-15 07:45:00+00")')).toBe("2026-01-15T07:30:00.000Z");
  });
  it("formats EGP", () => expect(money(1234.5, "en")).toMatch(/1,234\.50/));
});

describe("role workspaces", () => {
  it("front desk gets reception, not accounting", () => {
    const p = new Set(["patient.read", "patient.write", "appointment.write", "billing.read", "cash.session"]);
    const hrefs = navFor(p).map((i) => i.href);
    expect(hrefs).toContain("/os/reception");
    expect(hrefs).not.toContain("/os/accounting");
    expect(homeFor(p)).toBe("/os/reception");
  });
  it("doctor lands in own clinic and cannot open billing", () => {
    const p = new Set(["patient.read.assigned", "clinical.write.own"]);
    expect(homeFor(p)).toBe("/os/doctor");
    expect(canAccess("/os/billing/123", p)).toBe(false);
  });
  it("no permissions → no home", () => expect(homeFor(new Set())).toBeNull());
});

describe("errors", () => {
  it("maps known DB errors", () => {
    expect(friendlyError('conflicting key value violates exclusion constraint "no_doctor_overlap"', "en")).toMatch(/doctor already/);
    expect(friendlyError("new row violates row-level security policy", "ar")).toMatch(/صلاحية/);
  });
  it("never leaks raw text", () => expect(friendlyError("relation x does not exist", "en")).toMatch(/Nothing was saved/));
});

describe("appointment flow", () => {
  it("covers every status", () => APPOINTMENT_STATUSES.forEach((s) => expect(NEXT_STATUS[s]).toBeDefined()));
  it("suggests check-in for booked", () => expect(primaryAction("booked")).toBe("arrived"));
  it("terminal states have no actions", () => expect(primaryAction("completed")).toBeNull());
});

describe("i18n", () => {
  it("has Arabic and English for the same keys", () => {
    expect(translator("ar")("nav.reception")).toBe("الاستقبال");
    expect(translator("en")("nav.reception")).toBe("Reception");
  });
});
