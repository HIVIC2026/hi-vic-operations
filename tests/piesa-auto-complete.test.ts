// Join ruling 3 (4 Nov 2026): ONE automatic PIESA completion — main's Part 3 Task 4b trigger (installers' own jobs, once per
// version of the Mitti form, retried when the form is edited) merged with fix wave J4 G1 (in-house jobs; the A3 must carry the
// electrician's signature; the same checks `completePiesaAssessment` runs; ONE office Needs me row naming what is missing).
// Home Insulation Victoria-lead (non-in-house) jobs are untouched. The completion itself is a recorder here (its own checks
// are covered by tests/piesa-complete-*.test.ts and the A1 journey).
import { describe, expect, mock, test } from "bun:test";
import { buildNeedsRows } from "../src/lib/office-needs.core";

const events: { id?: string; job_id: string; event_type: string; summary: string; details: Record<string, unknown> }[] = [];
let inHouse = true, ownJob: boolean | null = false, stage = "piesa_scheduled", completeThrows: string | null = null;
const completions: (string | null)[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const b: Record<string, unknown> = {};
  let types: string[] = [];
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b["in"] = (_c: string, v: string[]) => { types = v; return b; };
  b["maybeSingle"] = async () => ({ data: t === "workflow_events" ? [...events].reverse().find((e) => types.includes(e.event_type)) ?? null : null, error: null });
  b["insert"] = async (row: { id: string; job_id: string; event_type: string; summary: string; details: Record<string, unknown> }) => {
    if (events.some((e) => e.id === row.id)) return { error: { code: "23505", message: "duplicate" } };
    events.push(row); return { error: null };
  };
  return b;
} } }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, getStage: async () => stage, logEvent: async (job_id: string, _a: string | null, event_type: string, summary: string, details: Record<string, unknown>) => { events.push({ job_id, event_type, summary, details }); } }));
mock.module("../src/lib/in-house-suppression.server", () => ({ readInHouseDispatchState: async (ids: string[]) => ({ failed: false, held: new Set(inHouse ? ids : []) }) }));
mock.module("../src/lib/own-job-piesa.server", () => ({ ownJobCallAndBook: async () => ownJob }));
mock.module("../src/lib/piesa-complete.server", () => ({ completePiesaAssessment: async (d: { jobId: string }, actor: string | null) => { completions.push(actor); if (completeThrows) throw new WorkflowError(completeThrows); return d; } }));

const { autoCompletePiesa, clearPiesaAutoCompleteHold, PIESA_AUTO_SIGNATURE_MISSING } = await import("../src/lib/piesa-auto-complete.server");
const reset = () => { events.length = 0; completions.length = 0; inHouse = true; ownJob = false; stage = "piesa_scheduled"; completeThrows = null; };
const held = () => events.filter((e) => e.event_type === "piesa_auto_complete_held");
const claims = () => events.filter((e) => e.event_type === "piesa_auto_completed");
const f = (over: Partial<{ completed: boolean; signed: boolean; auditId: string; modifiedAt: string }> = {}) => ({ completed: true, signed: true, auditId: "a1", modifiedAt: "m1", ...over });

describe("ONE automatic PIESA completion (in-house jobs + installers' own jobs)", () => {
  test("Home Insulation Victoria lead (not in-house, not an own job): nothing is completed, nothing recorded", async () => {
    reset(); inHouse = false; ownJob = false;
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "not_applicable" });
    expect(completions).toEqual([]); expect(events).toEqual([]);
  });
  test("unreadable in-house / own-job state claims nothing (fail closed; the next sync tries again)", async () => {
    reset(); inHouse = false; ownJob = null;
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "unreadable" });
    expect(events).toEqual([]);
  });
  test("a form not yet complete (evidence missing) is not tried; a job not at PIESA booked is not due", async () => {
    reset();
    expect(await autoCompletePiesa("j", null, f({ completed: false }))).toEqual({ outcome: "not_ready" });
    stage = "piesa_complete";
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "not_due" });
    expect(completions).toEqual([]); expect(events).toEqual([]);
  });
  test("an installer's own job (not in-house) completes too — with a null actor, so the sign-off falls to the electrician's login / installer account", async () => {
    reset(); inHouse = false; ownJob = true;
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "completed" });
    expect(completions).toEqual([null]);
    expect(claims()).toHaveLength(1);
    expect(claims()[0]!.details).toMatchObject({ audit_id: "a1", modified_at: "m1", scope: "own_job" });
  });
  test("once per form version: an unchanged re-sync is 'already'; an edited form (new modified time) is tried again", async () => {
    reset();
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "completed" });
    expect(await autoCompletePiesa("j", null, f())).toEqual({ outcome: "already" });
    expect(completions).toHaveLength(1);
    expect(await autoCompletePiesa("j", null, f({ modifiedAt: "m2" }))).toEqual({ outcome: "completed" });
    expect(completions).toHaveLength(2);
  });
  test("complete but unsigned: held with the signature line, once per form version; signed next edit → completed and the row cleared", async () => {
    reset();
    expect(await autoCompletePiesa("j", null, f({ signed: false }))).toEqual({ outcome: "held", reason: PIESA_AUTO_SIGNATURE_MISSING });
    expect(await autoCompletePiesa("j", null, f({ signed: false }))).toEqual({ outcome: "already" });
    expect(held()).toHaveLength(1);
    expect(held()[0]!.details).toMatchObject({ reason: PIESA_AUTO_SIGNATURE_MISSING, audit_id: "a1", needs_office: true });
    expect(completions).toEqual([]);
    expect(await autoCompletePiesa("j", null, f({ signed: true, modifiedAt: "m2" }))).toEqual({ outcome: "completed" });
    expect(completions).toEqual([null]);
    await clearPiesaAutoCompleteHold("j", null); // completePiesaAssessment calls this on success
    expect(events.filter((e) => /piesa_auto_complete_(held|recovered)/.test(e.event_type)).map((e) => e.event_type)).toEqual(["piesa_auto_complete_held", "piesa_auto_complete_recovered"]);
    await clearPiesaAutoCompleteHold("j", null); // nothing held any more → nothing added
    expect(events.filter((e) => /piesa_auto_complete_(held|recovered)/.test(e.event_type))).toHaveLength(2);
  });
  test("a completion check that fails (the same checks Complete PIESA runs) is the held reason; a changed reason on an edited form is a new row; 'already complete' is not a hold", async () => {
    reset(); completeThrows = "PIESA evidence still needed on the Mitti form: switchboard photo";
    expect(await autoCompletePiesa("j", "u", f())).toMatchObject({ outcome: "held", reason: completeThrows });
    completeThrows = "Still needed: assessment date";
    await autoCompletePiesa("j", "u", f({ modifiedAt: "m2" }));
    expect(held().map((e) => e.details["reason"])).toEqual(["PIESA evidence still needed on the Mitti form: switchboard photo", "Still needed: assessment date"]);
    completeThrows = "Electrical assessment is already complete.";
    expect(await autoCompletePiesa("j", "u", f({ modifiedAt: "m3" }))).toEqual({ outcome: "already_complete" });
    expect(held()).toHaveLength(2);
  });
  test("Needs me: the held fact is one 'today' row naming what is missing, cleared by the fact; main's own_job_piesa_complete_held kind is gone", () => {
    const job = { jobId: "one", jobNumber: "HV-TEST", surname: "Test", suburb: null };
    const rows = Object.values(buildNeedsRows({ now: Date.now(), jobs: [{ ...job, piesaAutoCompleteHeld: { at: "2026-11-04T00:00:00Z", reason: PIESA_AUTO_SIGNATURE_MISSING } }] })).flat();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "piesa_auto_complete_held", group: "today", line: `Safety check (PIESA) not completed by itself: ${PIESA_AUTO_SIGNATURE_MISSING}` });
    expect(Object.values(buildNeedsRows({ now: Date.now(), jobs: [job] })).flat()).toHaveLength(0);
    expect(JSON.stringify(Object.values(buildNeedsRows({ now: Date.now(), jobs: [{ ...job, ownJobPiesaCompleteHeld: { at: "x", reason: "y" } } as never] })))).not.toContain("own_job_piesa_complete_held");
  });
});
