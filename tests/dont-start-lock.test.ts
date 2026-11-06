// Jo 7 Nov 2026: DON'T START is a hard lock. An install can only be recorded complete after a GO (the latest GO / DON'T START
// check for that install start passed) — on every job, HIV leads and installers' own customers alike. A Mitti Install day
// sync without a GO keeps the evidence, leaves the job where it is and raises the DON'T START row on Needs me.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const START = "2026-11-10T22:00:00.000Z";
let T: Tables = {};
const db = { from: (t: string) => memoryPostgrest(T).from(t) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
class WorkflowError extends Error {}
let transitions: string[] = [], events: { type: string; summary: string; details: Record<string, unknown> }[] = [];
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  confirmedInstallBooking: async () => ({ booking: { id: "b1", scheduled_start: START }, blocker: null }),
  transition: async (_j: string, to: string) => { transitions.push(to); },
  logEvent: async (_j: string, _a: unknown, type: string, summary: string, details: Record<string, unknown> = {}) => { events.push({ type, summary, details }); },
}));
// Ruler photos / A5 fingerprint: always current and complete in these tests (their own tests live in four-bugs-evidence).
mock.module("../src/lib/install-evidence.server", () => ({
  latestInstallEvidenceRecord: async () => ({ audit_id: "a5", createdAt: "2026-11-11T05:00:00Z", summary: { jobId: "j1", auditId: "a5", auditFingerprint: "fp", rulerBlockers: [] } }),
  latestInstallEvidence: async () => null,
}));
mock.module("../src/lib/mitti.server", () => ({ realMittiCall: async () => ({}) }));
mock.module("../src/lib/mitti-create-claim.core", () => ({ stableUuid: async () => "fp" }));
mock.module("../src/lib/invoice-dates.server", () => ({ setCompletedBalanceDueDate: async () => {} }));
mock.module("../src/lib/area-diagram.server", () => ({ fileFinalAreaDiagram: async () => {} }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => {} }));
mock.module("../src/lib/veec-reminders.server", () => ({ sendVeecSignStep: async () => {} }));
mock.module("../src/lib/owner-email-triggers.server", () => ({ onFinalInvoiceDue: async () => {} }));
// PIISA timing facts for the Mitti path: all in order.
mock.module("../src/lib/piisa-prestart.server", () => ({ latestPrestart: async () => ({ snapshot: { signature: { signed_at: "2026-11-11T01:00:00Z" } } }) }));
mock.module("../src/lib/electrical-clearance.server", () => ({ clearanceFacts: async () => ({ piesaCompletedAt: "2026-11-01" }) }));
mock.module("../src/lib/no-esc.server", () => ({ noEscFor: async () => true }));
mock.module("../src/lib/prestart.server", () => ({ latestNotices: async () => ({ current: null }) }));
afterAll(() => mock.restore());

const { recordInstallationComplete } = await import("../src/lib/install-complete.server");
const { maybeRecordInstallationFromMitti, INSTALL_COMPLETE_HELD_EVENT } = await import("../src/lib/install-complete-mitti.server");

function seed(source = "base44", checks: Record<string, unknown>[] = []) {
  T = {
    jobs: [{ id: "j1", source, stage: "installation_booked", installation_completed_at: null }],
    pre_start_checks: checks.map((c) => ({ job_id: "j1", ...c })),
    workflow_events: [{ job_id: "j1", event_type: "mitti_piisa_audit_created", details: { audit_id: "a5" }, created_at: "2026-11-11T04:00:00Z" }],
    bookings: [],
  };
  transitions = []; events = [];
}
const failed = { scheduled_start: START, passed: false, failures: ["Certificate of Electrical Safety not in yet"], checked_at: "2026-11-10T03:00:00Z" };
const passed = { scheduled_start: START, passed: true, failures: [], checked_at: "2026-11-10T19:30:00Z" };
beforeEach(() => seed());

test("manual install done without GO is refused", async () => {
  seed("base44", [failed]);
  await expect(recordInstallationComplete("j1", "office-user", "office_button")).rejects.toThrow("Not cleared to start: Certificate of Electrical Safety not in yet");
  expect(transitions).toEqual([]);
  expect(T["jobs"]![0]!["installation_completed_at"]).toBeNull();
  seed("base44", []);
  await expect(recordInstallationComplete("j1", "office-user", "installer_button")).rejects.toThrow("Not cleared to start: The pre-start check has not run yet for this install date.");
  expect(transitions).toEqual([]);
});

test("install done with GO works", async () => {
  seed("base44", [failed, passed]);
  expect(await recordInstallationComplete("j1", "office-user", "office_button")).toEqual({ ok: true, already: false });
  expect(transitions).toEqual(["evidence_outstanding"]);
  expect(T["jobs"]![0]!["installation_completed_at"]).not.toBeNull();
});

test("a GO for a different (old) install start does not count", async () => {
  seed("base44", [{ ...passed, scheduled_start: "2026-11-03T22:00:00.000Z" }]);
  await expect(recordInstallationComplete("j1", null, "office_button")).rejects.toThrow("Not cleared to start");
});

test("mitti install sync without GO keeps evidence and flags", async () => {
  seed("base44", [failed]);
  const before = T["workflow_events"]!.length;
  const r = await maybeRecordInstallationFromMitti("j1", null, "a5", { formCompleted: true, declarationSaved: true, allFilledInTicked: true, summary: { applies: true, blockers: [], rulerBlockers: [] } as never });
  expect(r.recorded).toBe(false);
  expect(transitions).toEqual([]);
  expect(T["jobs"]![0]!["stage"]).toBe("installation_booked");
  expect(T["jobs"]![0]!["installation_completed_at"]).toBeNull();
  expect(T["workflow_events"]!.length).toBe(before); // the stored evidence rows are untouched
  const held = events.find((e) => e.type === INSTALL_COMPLETE_HELD_EVENT);
  expect(held?.details["no_go"]).toBe(true);
  expect(held?.summary).toContain("Not cleared to start: Certificate of Electrical Safety not in yet");
});

test("HIV lead and own customer both require GO", async () => {
  for (const source of ["base44", "installer_portal"]) {
    seed(source, []);
    await expect(recordInstallationComplete("j1", null, "office_button")).rejects.toThrow("Not cleared to start");
    seed(source, [passed]);
    expect((await recordInstallationComplete("j1", null, "office_button")).ok).toBe(true);
  }
  // The stage gate itself (any move into evidence_outstanding) checks the GO outside the installer-intake branch.
  const wf = readFileSync("src/lib/workflow.server.ts", "utf8");
  const intake = wf.indexOf("const { installDayBlockers }");
  const block = wf.slice(wf.lastIndexOf('if (to === "evidence_outstanding") {', intake), intake);
  expect(block).toContain("installGoBlockerFor(");
  expect(block.indexOf("installGoBlockerFor(")).toBeLessThan(block.indexOf("if (await m.isIntakeJob(jobId))"));
});

test("Needs me shows the DON'T START row for a Mitti install held without a GO", () => {
  const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
  expect(needs).toContain("installNoGoHeldFor(");
  expect(needs).toContain("noGoHoldsP = early(");
});

test("the no-GO hold row shows while the install is not recorded and clears on a later non-GO hold or once installed", async () => {
  const { installNoGoHeldFor } = await import("../src/lib/prestart.core");
  const noGo = { created_at: "2026-11-11T05:00:00Z", details: { no_go: true, outstanding: ["Not cleared to start: Certificate of Electrical Safety not in yet"] } };
  expect(installNoGoHeldFor("installation_booked", [noGo])).toEqual({ at: noGo.created_at, reasons: ["Certificate of Electrical Safety not in yet"] });
  expect(installNoGoHeldFor("evidence_outstanding", [noGo])).toBeNull();
  expect(installNoGoHeldFor("installation_booked", [noGo, { created_at: "2026-11-11T06:00:00Z", details: { outstanding: ["Install day form: x"] } }])).toBeNull();
});
