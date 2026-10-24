import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PIISA_AUTOSEND_TEST_ALLOWED, installDayInWindow, piisaAutoSendDecision, type PiisaAutoSendFacts } from "../src/lib/piisa-autosend.core";

const now = new Date("2026-11-02T03:00:00Z"); // Mon 2 Nov 2026, 2pm Melbourne (AEDT)
const ok: PiisaAutoSendFacts = { stage: "installation_booked", source: "web", deleted: false, archived: false, installStart: "2026-11-02T22:00:00Z" /* Tue 3 Nov 9am */, hasPiisaAudit: false, formBlocker: null, prestartLocked: false, lastFailureAt: null };

describe("automatic PIISA Mitti form before install day (Jo 24 Oct 2026)", () => {
  test("creates for tomorrow and the day after, Melbourne days", () => {
    expect(piisaAutoSendDecision(ok, now)).toEqual({ action: "create" });
    expect(installDayInWindow("2026-11-03T22:00:00Z", now)).toBe(true); // Wed 4 Nov
    expect(installDayInWindow("2026-11-02T04:00:00Z", now)).toBe(false); // later today
    expect(installDayInWindow("2026-11-04T22:00:00Z", now)).toBe(false); // Thu 5 Nov: too far
    expect(piisaAutoSendDecision({ ...ok, installStart: "2026-11-04T22:00:00Z" }, now).action).toBe("skip");
  });
  test("one form per job: an existing PIISA audit event stops it", () => {
    expect(piisaAutoSendDecision({ ...ok, hasPiisaAudit: true }, now)).toEqual({ action: "skip", reason: "PIISA form already created" });
  });
  test("respects the form approval, the pre-start lock and the booked stage", () => {
    expect(piisaAutoSendDecision({ ...ok, formBlocker: "The PIISA mapping hasn't been approved" }, now)).toEqual({ action: "skip", reason: "The PIISA mapping hasn't been approved" });
    expect(piisaAutoSendDecision({ ...ok, prestartLocked: true }, now)).toEqual({ action: "skip", reason: "pre-start check not cleared" });
    expect(piisaAutoSendDecision({ ...ok, stage: "installation_scheduling" }, now).action).toBe("skip");
    expect(piisaAutoSendDecision({ ...ok, deleted: true }, now).action).toBe("skip");
  });
  test("TEST jobs are skipped unless the TEST path is explicitly allowed", () => {
    expect(PIISA_AUTOSEND_TEST_ALLOWED).toBe(false);
    expect(piisaAutoSendDecision({ ...ok, source: "qa_test" }, now)).toEqual({ action: "skip", reason: "TEST job – office button only" });
    expect(piisaAutoSendDecision({ ...ok, source: "qa_test" }, now, { allowTest: true })).toEqual({ action: "create" });
  });
  test("a failed attempt is not retried in a loop", () => {
    expect(piisaAutoSendDecision({ ...ok, lastFailureAt: "2026-11-02T02:00:00Z" }, now).action).toBe("skip");
    expect(piisaAutoSendDecision({ ...ok, lastFailureAt: "2026-10-31T02:00:00Z" }, now).action).toBe("create");
  });
  test("tick order: the PIISA auto-send runs before the daily Mitti text", () => {
    const tick = readFileSync(new URL("../src/routes/api/public/hooks/allocation-tick.ts", import.meta.url), "utf8");
    expect(tick.indexOf("sweepPiisaAutoSend")).toBeGreaterThan(0);
    expect(tick.indexOf("sweepPiisaAutoSend")).toBeLessThan(tick.indexOf("sweepDailyMittiTexts"));
    const sweep = readFileSync(new URL("../src/lib/piisa-autosend.server.ts", import.meta.url), "utf8");
    expect(sweep).toContain("createPiisaMittiAudit(j.id, null)");
    expect(sweep).toContain("PIISA_AUTOSEND_FAILED_EVENT");
  });
});
