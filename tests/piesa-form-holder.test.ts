// Fix wave J5 (1), 4 Nov 2026: the automatic PIESA completion holds "The safety check form is still with a different
// electrician" when the A3 was last handed to someone other than the job's active electrician, or when a swap could not move
// the form (own_job_swap_form_not_moved newer than the last hand-over). Read failures and unknown emails hold too (fail closed).
import { describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let failTable: string | null = null;
let allocatedWorker: string | null = null;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => {
  const filters: ((r: Row) => boolean)[] = [];
  let desc = false, lim = Infinity;
  const b: Record<string, unknown> = {};
  b["select"] = () => b;
  b["eq"] = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; };
  b["is"] = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b; };
  b["in"] = (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; };
  b["order"] = (_c: string, o?: { ascending?: boolean }) => { desc = o?.ascending === false; return b; };
  b["limit"] = (n: number) => { lim = n; return b; };
  const run = () => {
    if (failTable === t) return { data: null, error: { message: "boom" } };
    let rows = (tables[t] ?? []).filter((r) => filters.every((f) => f(r)));
    if (desc) rows = [...rows].sort((a, c) => String(c["created_at"]).localeCompare(String(a["created_at"])));
    return { data: rows.slice(0, lim), error: null };
  };
  b["maybeSingle"] = async () => { const r = run(); return { data: r.error ? null : (r.data![0] ?? null), error: r.error }; };
  b["then"] = (res: (v: unknown) => void) => res(run());
  return b;
} } }));
mock.module("../src/lib/in-house-electrician.server", () => ({ allocatedWorkerId: async () => allocatedWorker }));

const { piesaFormHolderProblem, PIESA_FORM_WITH_OTHER_ELECTRICIAN } = await import("../src/lib/piesa-form-holder.server");
const HOLD = PIESA_FORM_WITH_OTHER_ELECTRICIAN;
const reshare = (email: string, at: string, extra: Row = {}) => ({ job_id: "j", event_type: "mitti_audit_reshared", summary: `PIESA form handed to ${email} (visit allocation)`, details: { audit_id: "a1", kind: "piesa", ...extra }, created_at: at });
const reset = (over: Partial<{ source: string; assignee: string | null }> = {}) => {
  failTable = null; allocatedWorker = null;
  for (const k of Object.keys(tables)) delete tables[k];
  tables["jobs"] = [{ id: "j", source: over.source ?? "website" }];
  tables["assessments"] = [{ job_id: "j", mitti_assignee_email: over.assignee === undefined ? "sparky@example.com" : over.assignee }];
  tables["job_assignments"] = [{ job_id: "j", role: "electrician", active: true, user_id: "u-e", business_id: "b1", assigned_at: "2026-11-01" }];
  tables["partner_workers"] = [{ id: "w1", business_id: "b1", profile_id: "u-e", email: "Sparky@example.com", removed_at: null }, { id: "w2", business_id: "b1", profile_id: null, email: "other@example.com", removed_at: null }];
  tables["profiles"] = [{ id: "u-e", email: "login@example.com" }];
  tables["workflow_events"] = [];
};

describe("PIESA form holder check (J5 (1))", () => {
  test("form created for the job's electrician, never re-handed: fine (case-insensitive)", async () => {
    reset();
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBeNull();
  });
  test("last handed to a different electrician than the active assignment's worker: held", async () => {
    reset();
    tables["workflow_events"] = [reshare("other@example.com", "2026-11-02T00:00:00Z")];
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBe(HOLD);
    tables["workflow_events"] = [reshare("other@example.com", "2026-11-02T00:00:00Z"), reshare("sparky@example.com", "2026-11-03T00:00:00Z", { email: "sparky@example.com" })];
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBeNull(); // the newest hand-over wins (details.email preferred)
  });
  test("a swap that could not move the form, newer than the last hand-over: held; an older one is history", async () => {
    reset();
    tables["workflow_events"] = [reshare("sparky@example.com", "2026-11-02T00:00:00Z"), { job_id: "j", event_type: "own_job_swap_form_not_moved", summary: "x", details: {}, created_at: "2026-11-03T00:00:00Z" }];
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBe(HOLD);
    tables["workflow_events"] = [reshare("sparky@example.com", "2026-11-04T00:00:00Z"), { job_id: "j", event_type: "own_job_swap_form_not_moved", summary: "x", details: {}, created_at: "2026-11-03T00:00:00Z" }];
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBeNull();
  });
  test("in-house: the allocated Team worker (no login) is the expected holder", async () => {
    reset(); allocatedWorker = "w2";
    tables["job_assignments"] = [{ job_id: "j", role: "electrician", active: true, user_id: null, business_id: "b1", assigned_at: "2026-11-01" }];
    tables["workflow_events"] = [reshare("other@example.com", "2026-11-02T00:00:00Z", { email: "other@example.com" })];
    expect(await piesaFormHolderProblem("j", "a1", "in_house")).toBeNull();
    allocatedWorker = "w1";
    expect(await piesaFormHolderProblem("j", "a1", "in_house")).toBe(HOLD);
  });
  test("fail closed: no active electrician, unknown holder, or a read failure is the same hold; TEST jobs always match", async () => {
    reset(); tables["job_assignments"] = [];
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBe(HOLD);
    reset({ assignee: null });
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBe(HOLD);
    reset(); failTable = "workflow_events";
    expect(await piesaFormHolderProblem("j", "a1", "own_job")).toBe(HOLD);
    reset({ source: "qa_test", assignee: "jo@actpropertyinspections.com.au" });
    expect(await piesaFormHolderProblem("j", "a1", "in_house")).toBeNull();
  });
});
