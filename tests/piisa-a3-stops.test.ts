import { describe, expect, test } from "bun:test";
import published from "./fixtures/piisa-a3-published.json";
import { a3CrewNativeItems, a3PrestartBlockers, a3StopWork, crewSelectionProblems, parseA3Answers, staffFromRecords, A3_CREW_OTHER_FIELDS, A3_CREW_OTHER_OPTION, type A3Media } from "../src/lib/piisa-a3.core";
import { piisaPrefill, seedAnswers } from "../src/lib/official-prefill.core";

const SAFE: Record<string, string | string[]> = { "p1.powerInformed": "Yes", lifeSupport: "No", "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes", "p4.present": "No", "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.recessed": "No", "p5.rcd": "Yes", "p5.tps": "Yes", "p5.basic": "Yes", "p5.noAccess": "Yes", "p6.present": "No" };
const ctx = { electricianRequiredAtStart: false, lifeSupportConsentOnFile: false };
const stops = (patch: Record<string, string | string[] | undefined>, c = ctx) => a3StopWork({ ...SAFE, ...patch } as never, c);

describe("STOP-WORK gates (Jo 8 Oct 2026)", () => {
  test("all safe, presence questions No -> green, nothing blocks", () => expect(stops({})).toEqual([]));
  test("power-off notice No -> STOP, tell household", () => expect(stops({ "p1.powerInformed": "No" })[0]).toMatch(/^STOP - Please ensure the household is aware the power will be turned off before continuing\.$/));
  test("life support Yes: consent No, unanswered, or not attached -> STOP banner", () => {
    expect(stops({ lifeSupport: "Yes", lifeSupportConsent: "No" })[0]).toMatch(/🛑 STOP —/);
    expect(stops({ lifeSupport: "Yes" })[0]).toMatch(/🛑 STOP —/);
    expect(stops({ lifeSupport: "Yes", lifeSupportConsent: "Yes – received Consent" })[0]).toMatch(/Attach the life support consent/);
    expect(stops({ lifeSupport: "Yes", lifeSupportConsent: "Yes – received Medical Plan" }, { ...ctx, lifeSupportConsentOnFile: true })).toEqual([]);
  });
  test("SWMS / Table 1 / isolation / PIESA review No -> STOP", () => {
    expect(stops({ "p3.swms": "No" })).toHaveLength(1);
    expect(stops({ "p3.table1": "No" })[0]).toMatch(/^🛑 STOP —/);
    expect(stops({ "p3.isolated": "No" })).toHaveLength(1);
    expect(stops({ "p5.reviewed": "No" })[0]).toMatch(/read the PIESA and confirm it is safe/);
  });
  test("electrician No -> STOP banner; N/A invalid when the signed PIESA or shutdown needs one", () => {
    expect(stops({ "p5.electricianPresent": "No" })[0]).toMatch(/🛑 STOP —/);
    expect(stops({}, { ...ctx, electricianRequiredAtStart: true })[0]).toMatch(/N\/A is not valid/);
    expect(stops({ "p4.present": "Yes", "p4.instructions": "No", "p4.isolator": "Yes" }).join()).toMatch(/N\/A is not valid/);
    expect(stops({ "p5.electricianPresent": "Yes" }, { ...ctx, electricianRequiredAtStart: true })).toEqual([]);
  });
  test("follow-ups apply only when their trigger is Yes", () => {
    expect(stops({ "p4.present": "Yes", "p4.instructions": "Yes", "p4.isolator": "No" })[0]).toMatch(/isolator/);
    expect(stops({ "p5.recessed": "Yes", "p5.icConfirmed": "Yes", "p5.safeToCover": "No" })[0]).toMatch(/safe to cover/);
    expect(stops({ "p5.recessed": "No", "p5.safeToCover": "No" })).toEqual([]);
  });
  test("RCD / TPS / basic / no-access No -> STOP", () => {
    for (const k of ["p5.rcd", "p5.tps", "p5.basic", "p5.noAccess"]) expect(stops({ [k]: "No" })[0]).toMatch(/^🛑 STOP —/);
  });
  test("unsuitable insulation can't be topped up; remove-only stays valid", () => {
    expect(stops({ "p6.present": "Yes", "p6.suitable": "No", "p6.treatment": ["Topped Up"] })[0]).toMatch(/remove it first/);
    expect(stops({ "p6.present": "Yes", "p6.suitable": "No", "p6.treatment": ["Removed"] })).toEqual([]);
  });
  test("unknown is never treated as No: unanswered blocks", () => {
    expect(stops({ "p4.present": undefined, "p6.present": undefined }).join()).toMatch(/Solar.*not answered.*Existing insulation: not answered/);
  });
  test("prestart gate includes stops but never after-work evidence", () => {
    const before: A3Media[] = [{ key: "installer_photos", count: 1, geotagged: 1, timed: 1 }, { key: "isolation_photo", count: 1, geotagged: 1, timed: 1 }, { key: "before_video", count: 1, geotagged: 0, timed: 1 }, { key: "product_photos", count: 1, geotagged: 1, timed: 1 }];
    const full = { ...ctx, crewCount: 1, existingPlanMatchesInstall: false };
    expect(a3PrestartBlockers(SAFE as never, full, before)).toEqual([]);
    expect(a3PrestartBlockers({ ...SAFE, "p3.swms": "No" } as never, full, before)).toEqual(stops({ "p3.swms": "No" }));
  });
});

describe("one start date -> both official dates; completion same day, editable", () => {
  const base = { today: "2026-10-08", jobNumber: "HV-1", address: "1 St", lifeSupportDeclared: "no", installDate: "2026-10-09", apName: "AP", installerBusinessName: "Co", leadInstaller: null, piesaAnswers: null, piesaLifeSupportAttachment: null } as never;
  test("seed: start + Part 2 install date = booked date; completion defaults to the same day", () => {
    const s = seedAnswers(piisaPrefill(base));
    expect([s["startDate"], s["p2.installDate"], s["completionDate"]]).toEqual(["2026-10-09", "2026-10-09", "2026-10-09"]);
  });
  test("a recorded end date wins over the same-day default", () => {
    expect(seedAnswers(piisaPrefill({ ...(base as object), predictedCompletionDate: "2026-10-11" } as never))["completionDate"]).toBe("2026-10-11");
  });
  test("installer's edited dates on the audit are what the official form takes (start copied to Part 2)", () => {
    const a = parseA3Answers({ items: [
      { item_id: "78e550a4-1c8b-4b59-be77-64a5c09ba848", label: "Installation start date", type: "datetime", responses: { datetime: "2026-10-10" } },
      { item_id: "84a8b69b-efd5-4830-9da7-66958cbfdb6e", label: "Expected completion date", type: "datetime", responses: { datetime: "2026-10-12" } },
    ] }).answers;
    expect([a["startDate"], a["p2.installDate"], a["completionDate"]]).toEqual(["2026-10-10", "2026-10-10", "2026-10-12"]);
  });
});

describe("two companies: crew strictly scoped, nothing leaks through the shared form", () => {
  const W = (id: string, biz: string, name: string, cert: string, approved = "approved") => ({ id, full_legal_name: name, certification: { verification_id: cert }, approval_status: approved, removed_at: null, trade_role: "installer", licence_expires_on: null, business_id: biz });
  const C = (id: string, worker: string, num: string) => ({ id, status: "verified", certificate_number: num, issuer: "EEC", worker_id: worker });
  const rowsA = [W("a1", "A", "Alice A", "00000000-0000-4000-8000-0000000000a1")], rowsB = [W("b1", "B", "Bob B", "00000000-0000-4000-8000-0000000000b1", "pending")];
  const certs = [C("00000000-0000-4000-8000-0000000000a1", "a1", "EEC-A1"), C("00000000-0000-4000-8000-0000000000b1", "b1", "EEC-B1")];
  const lv = (cert: string) => ({ certification_id: cert, level: "full", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" });
  const staffA = staffFromRecords(rowsA as never, certs as never, [lv("00000000-0000-4000-8000-0000000000a1")], undefined, "2026-10-24");
  const staffB = staffFromRecords(rowsB as never, certs as never, [], undefined, "2026-10-24");
  test("company A's items carry only A's own recorded facts, through Other", () => {
    const r = a3CrewNativeItems(published, { lead: "a1", additional: [] }, staffA, "A Co");
    const text = JSON.stringify(r.items);
    expect(text).toContain("Alice A"); expect(text).toContain("EEC-A1");
    expect(text).not.toContain("Bob"); expect(text).not.toContain("EEC-B1");
    expect(r.items[0].responses.selected[0].id).toBe(A3_CREW_OTHER_OPTION);
    expect(r.items[1]).toEqual({ item_id: A3_CREW_OTHER_FIELDS[0]!.name, type: "text", responses: { text: "Alice A" } });
  });
  test("company B's worker can't be picked for A's job (not in A's roster)", () => {
    expect(crewSelectionProblems({ lead: "b1", additional: [] }, staffA).problems.length).toBeGreaterThan(0);
  });
  test("decision 153: verified without a recorded level/expiry blocks the form; certificate stays recorded; approval_status is not the gate", () => {
    expect(staffB[0]).toMatchObject({ approved: false, cleared: false, eec: "EEC-B1", eecVerified: true });
    expect(crewSelectionProblems({ lead: "b1", additional: [] }, staffB).problems.join()).toMatch(/level and expiry/i);
    expect(crewSelectionProblems({ lead: "a1", additional: [] }, staffA).problems).toEqual([]);
  });
  test("the shared published form contains no staff names", () => {
    const s = JSON.stringify(published).toLowerCase();
    for (const n of ["bhavdeep", "dominic", "reinsulate", "cii-027"]) expect(s).not.toContain(n);
  });
});
