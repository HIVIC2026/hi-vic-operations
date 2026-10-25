import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_OFFICE_EVENT, PIISA_AUTOSEND_RETRY_AFTER_HOURS, PIISA_AUTOSEND_TEST_ALLOWED, installDayInWindow, piisaAutoSendDecision,
  piisaAutoSendOfficeAlertDue, piisaFormFailedOpen, type PiisaAutoSendFacts,
} from "../src/lib/piisa-autosend.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";

const now = new Date("2026-11-02T03:00:00Z"); // Mon 2 Nov 2026, 2pm Melbourne (AEDT)
const ok: PiisaAutoSendFacts = { stage: "installation_booked", source: "web", deleted: false, archived: false, installStart: "2026-11-02T22:00:00Z" /* Tue 3 Nov 9am */, hasPiisaAudit: false, formBlocker: null, prestartLocked: false, lastFailureAt: null };

describe("automatic PIISA Mitti form before install day (Jo 24 Oct 2026)", () => {
  test("creates for today (until the install starts), tomorrow and the day after, Melbourne days", () => {
    expect(piisaAutoSendDecision(ok, now)).toEqual({ action: "create" });
    expect(installDayInWindow("2026-11-03T22:00:00Z", now)).toBe(true); // Wed 4 Nov
    expect(installDayInWindow("2026-11-02T04:00:00Z", now)).toBe(true); // F15: later today, not started yet
    expect(installDayInWindow("2026-11-02T02:00:00Z", now)).toBe(false); // today, already started
    expect(installDayInWindow("2026-11-04T22:00:00Z", now)).toBe(false); // Thu 5 Nov: too far
    expect(piisaAutoSendDecision({ ...ok, installStart: "2026-11-04T22:00:00Z" }, now).action).toBe("skip");
    expect(piisaAutoSendDecision({ ...ok, installStart: "2026-11-02T04:00:00Z" }, now)).toEqual({ action: "create" });
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
  test("a failed attempt is not retried every tick, but again after about an hour (F15)", () => {
    expect(PIISA_AUTOSEND_RETRY_AFTER_HOURS).toBe(1);
    expect(piisaAutoSendDecision({ ...ok, lastFailureAt: "2026-11-02T02:30:00Z" }, now).action).toBe("skip"); // 30 min ago
    expect(piisaAutoSendDecision({ ...ok, lastFailureAt: "2026-11-02T02:00:00Z" }, now).action).toBe("create"); // 1h ago
    expect(piisaAutoSendDecision({ ...ok, lastFailureAt: "2026-10-31T02:00:00Z" }, now).action).toBe("create");
  });
  test("F15: a failure with the install today or tomorrow raises one Needs me row, cleared by a form created later", () => {
    expect(piisaAutoSendOfficeAlertDue("2026-11-02T22:00:00Z", now)).toBe(true); // tomorrow
    expect(piisaAutoSendOfficeAlertDue("2026-11-02T04:00:00Z", now)).toBe(true); // today
    expect(piisaAutoSendOfficeAlertDue("2026-11-03T22:00:00Z", now)).toBe(false); // the day after: retries first
    const alert = { event_type: PIISA_AUTOSEND_OFFICE_EVENT, created_at: "2026-11-02T03:00:00Z", details: { message: "Mitti user not found" } };
    const open = piisaFormFailedOpen([alert]);
    expect(open).toEqual({ at: "2026-11-02T03:00:00Z", text: "Install day form not created in Mitti · Mitti user not found · create it from the job" });
    expect(piisaFormFailedOpen([alert, { event_type: PIISA_AUDIT_CREATED_EVENT, created_at: "2026-11-02T04:00:00Z" }])).toBeNull();
    expect(piisaFormFailedOpen([alert, { event_type: PIISA_AUDIT_CREATED_EVENT, created_at: "2026-11-01T04:00:00Z" }])).not.toBeNull();
    const rows = buildNeedsRows({ now: Date.parse("2026-11-02T03:30:00Z"), jobs: [{ jobId: "j", jobNumber: "HV-1", surname: "Yang", suburb: "Reservoir", piisaFormFailed: open }] });
    expect(rows.today).toHaveLength(1);
    expect(rows.today[0]).toMatchObject({ kind: "piisa_form_failed", button: { label: "Open job", to: "job", section: "install" } });
    const sweep = readFileSync(new URL("../src/lib/piisa-autosend.server.ts", import.meta.url), "utf8");
    expect(sweep).toContain("piisaAutoSendOfficeAlertDue(start, now)");
    const needs = readFileSync(new URL("../src/lib/office-needs.server.ts", import.meta.url), "utf8");
    expect(needs).toContain("piisaFormFailedOpen(");
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
