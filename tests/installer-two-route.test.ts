// Jo 20 Oct 2026 "Ok fix": attendance and quote are independent; four combinations (pure rules).
import { describe, expect, test } from "bun:test";
import { applicableIntakeDetails, attendanceFromSiteCheck, attendedOnDate, intakeBranches, intakeNextAction, intakeProblems, intakeQuotePayload, pickIntakeChanges, recoveredIntakeReceipt } from "../src/lib/installer-intake.core";

const d = { area: "120", amount: "3450", includes: "R5 batts", proposedR: "5" };
const st = { coordination: "hivic_managed" as const, insulation: "none" as const, electricianPayer: "hivic" as const, feeAwarenessRecorded: false, feeAwarenessPayer: null };
describe("four attendance x quote combinations", () => {
  test("(a) not visited / not quoted: no price; any known size kept only as an optional estimate; Ready Check task", () => {
    const l = applicableIntakeDetails({ ...d, attended: "not_attended" as const, quoteStatus: "not_quoted" as const });
    expect([l.amount, l.includes]).toEqual(["", ""]);
    expect([l.area, l.proposedR]).toEqual(["120", "5"]); // typed by the installer: kept as a labelled preliminary estimate
    expect(intakeBranches("not_attended", "not_quoted")).toMatchObject({ siteFacts: false, estimateOnly: true, quoteFacts: false, readyCheckTask: true });
    expect(intakeNextAction("hivic_managed", false, "not_attended")).toMatch(/arranges the Ready Check/);
  });
  test("(b) visited / not quoted: measurements and product kept; finish quote; no second visit", () => {
    const l = applicableIntakeDetails({ ...d, attended: "attended" as const, quoteStatus: "not_quoted" as const });
    expect(l.area).toBe("120"); expect(l.proposedR).toBe("5"); expect(l.amount).toBe(""); expect(l.includes).toBe("");
    expect(intakeQuotePayload({ quoteStatus: "not_quoted", ...l }).proposed_r_value).toBe(5);
    expect(intakeBranches("attended", "not_quoted").readyCheckTask).toBe(false);
    expect(intakeNextAction("hivic_managed", false, "attended")).toMatch(/Finish your assessment.*no second visit/);
    expect(intakeProblems({ ...l, insulation: null, quoteFileCount: 0, evidenceAck: true, quoteStatus: "not_quoted", attended: "attended", requireMeasured: true })).toContain("Choose the existing insulation");
  });
  test("(c) visited / quoted: all facts apply", () => {
    expect(applicableIntakeDetails({ ...d, attended: "attended" as const, quoteStatus: "have_quote" as const })).toMatchObject(d);
    expect(intakeBranches("attended", "have_quote")).toMatchObject({ siteFacts: true, quoteFacts: true, preliminary: false });
  });
  test("(d) quoted / not visited: preliminary, Ready Check still required, area not demanded", () => {
    expect(intakeBranches("not_attended", "have_quote")).toMatchObject({ preliminary: true, readyCheckTask: true });
    expect(intakeNextAction("hivic_managed", true, "not_attended")).toMatch(/preliminary estimate.*Ready Check is still required/);
    const p = intakeProblems({ area: "", amount: "3000", includes: "batts", proposedR: "", insulation: null, quoteFileCount: 0, evidenceAck: true, quoteStatus: "have_quote", attended: "not_attended", requireMeasured: true });
    expect(p).not.toContain("Enter the measured ceiling area (m²)");
  });
  test("quoted PDF-only: amount not confirmed (quoted stays unknown)", () => {
    expect(intakeQuotePayload({ quoteStatus: "have_quote", amount: "", includes: "", proposedR: "" }).quoted).toBeNull();
  });
});
describe("attendance truth", () => {
  test("historic unanswered stays unknown; only explicit yes/no map", () => {
    expect(attendanceFromSiteCheck(null)).toBeNull(); expect(attendanceFromSiteCheck("yes")).toBe("attended"); expect(attendanceFromSiteCheck("no")).toBe("not_attended");
    expect(recoveredIntakeReceipt(st, "have_quote").attended).toBeNull();
  });
  test("visit date never invented or in the future", () => {
    expect(attendedOnDate("attended", null, "2026-10-20")).toBeNull();
    expect(attendedOnDate("attended", "2026-10-21", "2026-10-20")).toBeNull();
    expect(attendedOnDate("attended", "2026-10-02", "2026-10-20")).toBe("2026-10-02");
    expect(attendedOnDate("not_attended", "2026-10-02", "2026-10-20")).toBeNull();
  });
  test("switching to 'not yet' never clears the known product", () => {
    const ch = pickIntakeChanges({ areaM2: 120, insulation: "none", quoted: "yes", quoteIncGst: 3000, includes: "batts", proposedR: 5 }, { areaM2: null, insulation: "none", quoteStatus: "not_quoted", quoteIncGst: null, includes: null, proposedR: null, files: [] });
    expect(ch.proposedR).toBeUndefined(); expect(ch.area).toBeUndefined(); expect(ch.quote).toEqual({ quoted: "no", quoteIncGst: null, includes: null });
  });
});
