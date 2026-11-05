import { describe, expect, test } from "bun:test";
import { personApproval, dobLabel, escRegisteredLabel } from "../src/lib/person-approval.core";

describe("personApproval", () => {
  test("approved when CII verified, ESC notice signed and date of birth recorded", () => {
    expect(personApproval({ ciiVerified: true, noticeSigned: true, dateOfBirth: "1984-04-17" })).toEqual({ approved: true, label: "Approved", missing: [], missingLine: null });
  });
  test("lists what is missing in plain words", () => {
    expect(personApproval({ ciiVerified: true, noticeSigned: true, dateOfBirth: null })).toMatchObject({ approved: false, label: "Not approved yet", missing: ["date of birth"], missingLine: "Missing: date of birth" });
    expect(personApproval({ ciiVerified: false, noticeSigned: false, dateOfBirth: "" })).toMatchObject({ approved: false, missingLine: "Missing: CII, ESC notice, date of birth" });
  });
});

describe("labels", () => {
  test("date of birth", () => {
    expect(dobLabel("1984-04-17")).toBe("17 Apr 1984");
    expect(dobLabel(null)).toBe("Not recorded");
    expect(dobLabel("")).toBe("Not recorded");
  });
  test("ESC registered text", () => {
    expect(escRegisteredLabel("2026-11-05")).toBe("ESC registered · 5 Nov");
    expect(escRegisteredLabel("2026-11-04T14:30:00Z")).toBe("ESC registered · 5 Nov"); // Melbourne day, not UTC
    expect(escRegisteredLabel(null)).toBe("ESC registered");
  });
});

import { personRow } from "../src/lib/office-partners.core";
describe("personRow approval facts", () => {
  const base = { role: "installer", noticeFirstSentAt: null, mitti: "member" as const };
  test("ciiOk only when verified and cleared; noticeOk only when acknowledged", () => {
    expect(personRow({ ...base, eec: "verified", cii: { level: "full", expiresOn: "2029-05-19", cleared: true, reason: null }, noticeAck: true }, "2026-11-05")).toMatchObject({ ciiOk: true, noticeOk: true });
    expect(personRow({ ...base, eec: "awaiting_check", cii: null, noticeAck: false }, "2026-11-05")).toMatchObject({ ciiOk: false, noticeOk: false });
  });
});

import { groupPeople } from "../src/lib/person-approval.core";
describe("Mitti label is only Yes or No", () => {
  const f = { role: "installer", eec: "missing", cii: null, noticeAck: true, noticeFirstSentAt: null } as const;
  test.each([[null], ["unchecked"], ["email_changed"], ["not_found"]] as const)("%s -> No", (m) => {
    expect(personRow({ ...f, mitti: m as never }, "2026-11-05").mittiLabel).toBe("No");
  });
  test("member -> Yes", () => expect(personRow({ ...f, mitti: "member" }, "2026-11-05").mittiLabel).toBe("Yes"));
});
describe("groupPeople", () => {
  const P = (id: string, role: string, workerRole: "lead" | "crew" | null) => ({ id, role, workerRole });
  test("Lead Installers, Crew, Electricians in order, with counts; switching moves a person", () => {
    const people = [P("a", "installer", "crew"), P("b", "installer", "lead"), P("c", "electrician", null), P("d", "installer", null)];
    const g = groupPeople(people);
    expect(g.map((x) => [x.title, x.people.map((p) => p.id)])).toEqual([["Lead Installers", ["b"]], ["Crew", ["a", "d"]], ["Electricians", ["c"]]]);
    const moved = groupPeople(people.map((p) => (p.id === "b" ? { ...p, workerRole: "crew" as const } : p)));
    expect(moved.map((x) => x.people.length)).toEqual([0, 3, 1]);
  });
});

import { readFileSync } from "node:fs";
describe("People row source", () => {
  const src = readFileSync("src/components/portal/partner-people.tsx", "utf8");
  test("old big ESC date box is gone; small Lead-only control uses the existing server function", () => {
    expect(src).not.toContain("ESC registration date");
    expect(src).not.toContain("Record ESC registered");
    expect(src).toContain("Mark ESC registered");
    expect(src).toContain('p.workerRole === "lead" && <LeadEscRegistration');
    expect(src).toContain("officeRecordEscRegistered");
    expect(src).toContain("melbourneToday()");
  });
});
