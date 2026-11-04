// Fix wave J4 G1 (join ruling, 4 Nov 2026): on an IN-HOUSE job a synced A3 that is complete AND signed by the electrician
// completes the PIESA by itself through `completePiesaAssessment`; a failed check is ONE office Needs me row naming what is
// missing; Home Insulation Victoria-lead (non-in-house) jobs are untouched. The completion itself is a recorder here (its
// own checks are covered by tests/piesa-complete-*.test.ts and the A1 journey).
import { describe, expect, mock, test } from "bun:test";
import { buildNeedsRows } from "../src/lib/office-needs.core";

const events: { job_id: string; event_type: string; summary: string; details: Record<string, unknown> }[] = [];
let inHouse = true, completeThrows: string | null = null;
const completions: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const b: Record<string, unknown> = {};
  let types: string[] = [];
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b["in"] = (_c: string, v: string[]) => { types = v; return b; };
  b["maybeSingle"] = async () => ({ data: t === "workflow_events" ? [...events].reverse().find((e) => types.includes(e.event_type)) ?? null : null, error: null });
  return b;
} } }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async (job_id: string, _a: string | null, event_type: string, summary: string, details: Record<string, unknown>) => { events.push({ job_id, event_type, summary, details }); } }));
mock.module("../src/lib/in-house-suppression.server", () => ({ readInHouseDispatchState: async (ids: string[]) => ({ failed: false, held: new Set(inHouse ? ids : []) }) }));
mock.module("../src/lib/piesa-complete.server", () => ({ completePiesaAssessment: async (d: { jobId: string }) => { completions.push(d.jobId); if (completeThrows) throw new WorkflowError(completeThrows); } }));

const { autoCompleteInHousePiesa, clearPiesaAutoCompleteHold, PIESA_AUTO_SIGNATURE_MISSING } = await import("../src/lib/piesa-auto-complete.server");
const reset = () => { events.length = 0; completions.length = 0; inHouse = true; completeThrows = null; };
const held = () => events.filter((e) => e.event_type === "piesa_auto_complete_held");

describe("J4 G1: the synced A3 completes the PIESA on in-house jobs", () => {
  test("Home Insulation Victoria lead (not in-house): nothing is completed, nothing recorded", async () => {
    reset(); inHouse = false;
    expect(await autoCompleteInHousePiesa("j", null, { completed: true, signed: true, auditId: "a1" })).toEqual({ outcome: "not_in_house" });
    expect(completions).toEqual([]); expect(events).toEqual([]);
  });
  test("a form not yet complete (evidence missing) is not tried", async () => {
    reset();
    expect(await autoCompleteInHousePiesa("j", null, { completed: false, signed: true, auditId: "a1" })).toEqual({ outcome: "not_ready" });
    expect(completions).toEqual([]);
  });
  test("complete but unsigned: held with the signature line, once per form version; signed next sync → completed and the row cleared", async () => {
    reset();
    expect(await autoCompleteInHousePiesa("j", null, { completed: true, signed: false, auditId: "a1" })).toEqual({ outcome: "held", reason: PIESA_AUTO_SIGNATURE_MISSING });
    await autoCompleteInHousePiesa("j", null, { completed: true, signed: false, auditId: "a1" });
    expect(held()).toHaveLength(1);
    expect(held()[0]!.details).toMatchObject({ reason: PIESA_AUTO_SIGNATURE_MISSING, audit_id: "a1", needs_office: true });
    expect(completions).toEqual([]);
    expect(await autoCompleteInHousePiesa("j", null, { completed: true, signed: true, auditId: "a1" })).toEqual({ outcome: "completed" });
    expect(completions).toEqual(["j"]);
    await clearPiesaAutoCompleteHold("j", null); // completePiesaAssessment calls this on success
    expect(events.map((e) => e.event_type)).toEqual(["piesa_auto_complete_held", "piesa_auto_complete_recovered"]);
    await clearPiesaAutoCompleteHold("j", null); // nothing held any more → nothing added
    expect(events).toHaveLength(2);
  });
  test("a completion check that fails (the same checks Complete PIESA runs) is the held reason; a changed reason is a new row; 'already complete' is not a hold", async () => {
    reset(); completeThrows = "PIESA evidence still needed on the Mitti form: switchboard photo";
    expect(await autoCompleteInHousePiesa("j", "u", { completed: true, signed: true, auditId: "a1" })).toMatchObject({ outcome: "held", reason: completeThrows });
    completeThrows = "Still needed: assessment date";
    await autoCompleteInHousePiesa("j", "u", { completed: true, signed: true, auditId: "a1" });
    expect(held().map((e) => e.details["reason"])).toEqual(["PIESA evidence still needed on the Mitti form: switchboard photo", "Still needed: assessment date"]);
    completeThrows = "Electrical assessment is already complete.";
    expect(await autoCompleteInHousePiesa("j", "u", { completed: true, signed: true, auditId: "a1" })).toEqual({ outcome: "already_complete" });
    expect(held()).toHaveLength(2);
  });
  test("Needs me: the held fact is one 'today' row naming what is missing, cleared by the fact", () => {
    const job = { jobId: "one", jobNumber: "HV-TEST", surname: "Test", suburb: null };
    const rows = Object.values(buildNeedsRows({ now: Date.now(), jobs: [{ ...job, piesaAutoCompleteHeld: { at: "2026-11-04T00:00:00Z", reason: PIESA_AUTO_SIGNATURE_MISSING } }] })).flat();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "piesa_auto_complete_held", group: "today", line: `Safety check (PIESA) not completed by itself: ${PIESA_AUTO_SIGNATURE_MISSING}` });
    expect(Object.values(buildNeedsRows({ now: Date.now(), jobs: [job] })).flat()).toHaveLength(0);
  });
});
