// Decision 398 (Jo 26 Oct 2026, "Yes, automatic"): the A3 PIESA Mitti form is made automatically when the owner's PIESA
// time is booked, through the office "Create Mitti form" path (createAssignMittiAudit — faked here, its claim/reuse are
// covered by its own tests and the A1/A2 journeys). Never twice; a failure is ONE Needs me row per booking; the office
// button stays as the backup; TEST jobs only reach the TEST Mitti account.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PIESA_AUTOFORM_FAILED_EVENT, piesaAutoFormDecision, piesaFormFailedOpen } from "../src/lib/piesa-autoform.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";
import { TEST_MITTI_ASSIGNEE } from "../src/lib/onsite-ready-check.core";
import { TEST_PARTNER_MARK } from "../src/lib/test-send.core";

describe("pure rules", () => {
  test("create only for a live HIV job without a PIESA form", () => {
    const live = { deleted: false, archived: false, businessUnit: "hivic", hasPiesaForm: false };
    expect(piesaAutoFormDecision(live)).toEqual({ action: "create" });
    expect(piesaAutoFormDecision({ ...live, hasPiesaForm: true }).action).toBe("skip");
    expect(piesaAutoFormDecision({ ...live, deleted: true }).action).toBe("skip");
    expect(piesaAutoFormDecision({ ...live, archived: true }).action).toBe("skip");
    expect(piesaAutoFormDecision({ ...live, businessUnit: "other" }).action).toBe("skip");
  });
  test("the Needs me row: latest failure while the PIESA is booked and no form exists; cleared by the form", () => {
    const events = [{ created_at: "2026-10-26T01:00:00Z", details: { reason: "old" } }, { created_at: "2026-10-26T02:00:00Z", details: { reason: "The A3 template is not set up" } }];
    const open = piesaFormFailedOpen({ events, hasPiesaForm: false, stage: "piesa_scheduled" });
    expect(open).toEqual({ at: "2026-10-26T02:00:00Z", text: "Safety check (A3 PIESA) Mitti form not created automatically · The A3 template is not set up · press Create Mitti form on the job" });
    expect(piesaFormFailedOpen({ events, hasPiesaForm: true, stage: "piesa_scheduled" })).toBeNull();
    expect(piesaFormFailedOpen({ events, hasPiesaForm: false, stage: "piesa_complete" })).toBeNull();
    expect(piesaFormFailedOpen({ events: [], hasPiesaForm: false, stage: "piesa_scheduled" })).toBeNull();
    const rows = buildNeedsRows({ now: Date.parse("2026-10-26T03:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Sample", suburb: null, piesaFormFailed: open }] });
    expect(rows.today[0]).toMatchObject({ kind: "piesa_form_failed", button: { label: "Open job", to: "job", section: "piesa" } });
  });
});

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
const subset = (a: unknown, b: unknown): boolean => b && typeof b === "object" ? !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v)) : a === b;
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  let head = false;
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return q; },
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
    contains: (k: string, v: unknown) => { rows = rows.filter((r) => subset(r[k], v)); return q; },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) => res(head ? { data: null, error: null, count: rows.length } : { data: rows, error: null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (jobId: string, actorId: string | null, event_type: string, summary: string, details: Row) => { (tables["workflow_events"] ??= []).push({ job_id: jobId, actor_id: actorId, event_type, summary, details }); },
}));
class MittiClaimHeld extends Error {}
class MittiOutcomeUncertain extends Error {}
mock.module("../src/lib/mitti-create.server", () => ({ MittiClaimHeld, MittiOutcomeUncertain }));
const calls: { jobId: string; actorId: string | null; opts: Row }[] = [];
let behaviour: "ok" | "fail" | "held" | "uncertain" = "ok";
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async () => ({}),
  createAssignMittiAudit: async (jobId: string, actorId: string | null, _call: unknown, opts: Row = {}) => {
    calls.push({ jobId, actorId, opts });
    if (behaviour === "fail") throw new Error("Connect the A3 PIESA form in Settings first.");
    if (behaviour === "held") throw new MittiClaimHeld("already started");
    if (behaviour === "uncertain") throw new MittiOutcomeUncertain("lost reply");
    (tables["assessments"] ??= []).push({ job_id: jobId, external_mitti_id: "audit_1" });
    return { auditId: "audit_1", reused: false, scope: "ELECTRICAL_ONLY" };
  },
}));
const { onPiesaBooked } = await import("../src/lib/piesa-autoform.server");

function seed(o: { source?: string; testPartner?: boolean; form?: boolean } = {}) {
  calls.length = 0; behaviour = "ok";
  tables = {
    jobs: [{ id: "job-1", source: o.source ?? "base44", business_unit: "hivic", deleted_at: null, qa_archived_at: null }],
    assessments: o.form ? [{ job_id: "job-1", external_mitti_id: "audit_0" }] : [],
    job_assignments: [{ job_id: "job-1", role: "electrician", active: true, user_id: "elec-1", business_id: "rec-1", businesses: { onboarding_notes: o.testPartner ? TEST_PARTNER_MARK : null } }],
    workflow_events: [],
  };
}
const failures = () => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === PIESA_AUTOFORM_FAILED_EVENT);

describe("onPiesaBooked (called by confirmBooking kind assessment)", () => {
  beforeEach(() => seed());
  test("real job: the office path makes the form for the assigned electrician (no TEST override, no office override)", async () => {
    expect(await onPiesaBooked("job-1", "bk-1", "owner-1")).toMatchObject({ outcome: "created", auditId: "audit_1" });
    expect(calls).toEqual([{ jobId: "job-1", actorId: "owner-1", opts: {} }]);
    expect(failures()).toHaveLength(0);
  });
  test("never twice: a job that already has its PIESA form is left alone (a re-booking does nothing)", async () => {
    await onPiesaBooked("job-1", "bk-1", "owner-1");
    expect(await onPiesaBooked("job-1", "bk-2", "owner-1")).toMatchObject({ outcome: "skipped" });
    expect(calls).toHaveLength(1);
    seed({ form: true });
    expect(await onPiesaBooked("job-1", "bk-1", null)).toMatchObject({ outcome: "skipped", reason: "PIESA form already created" });
    expect(calls).toHaveLength(0);
  });
  test("TEST rules: a qa_test job or a TEST partner electrician → the TEST Mitti account only", async () => {
    for (const o of [{ source: "qa_test" }, { testPartner: true }]) {
      seed(o);
      await onPiesaBooked("job-1", "bk-1", null);
      expect(calls[0]!.opts).toEqual({ assignee: { userId: "elec-1", fullName: null, email: TEST_MITTI_ASSIGNEE } });
    }
  });
  test("failure → ONE Needs me event per booking with the reason; never throws", async () => {
    behaviour = "fail";
    expect(await onPiesaBooked("job-1", "bk-1", null)).toMatchObject({ outcome: "failed", reason: "Connect the A3 PIESA form in Settings first." });
    await onPiesaBooked("job-1", "bk-1", null);
    expect(failures()).toHaveLength(1);
    expect(failures()[0]!["details"]).toMatchObject({ booking_id: "bk-1", needs_office: true, reason: "Connect the A3 PIESA form in Settings first." });
    await onPiesaBooked("job-1", "bk-2", null); // a new booking may raise its own row
    expect(failures()).toHaveLength(2);
  });
  test("someone else is creating it right now → no row (their attempt stands); unknown result → a row saying check Mitti first", async () => {
    behaviour = "held";
    expect((await onPiesaBooked("job-1", "bk-1", null)).outcome).toBe("held");
    expect(failures()).toHaveLength(0);
    behaviour = "uncertain";
    expect((await onPiesaBooked("job-1", "bk-1", null)).outcome).toBe("failed");
    expect(String(failures()[0]!["details"] && (failures()[0]!["details"] as Row)["reason"])).toMatch(/check Mitti first/);
  });
  test("removed job → nothing", async () => {
    tables["jobs"]![0]!["deleted_at"] = "2026-10-20T00:00:00Z";
    expect((await onPiesaBooked("job-1", "bk-1", null)).outcome).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});
