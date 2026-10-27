// Mitti instant notice (one audit id) against an in-memory fake database and a mocked syncMittiAssessment:
// no network, no real database. Switch is read first; lookups by assessment, then current Mitti measurement.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let readError: { message: string } | null = null;
const reads: string[] = [];
const writes: string[] = [];
// "jobs.x" filters read the joined job (jobs!inner: a row with no job is dropped).
const val = (r: Row, k: string) => {
  if (!k.startsWith("jobs.")) return r[k];
  const j = (tables.jobs ?? []).find((x) => x.id === r.job_id);
  return j ? (j[k.slice(5)] ?? null) : undefined;
};
const hasJob = (r: Row) => (tables.jobs ?? []).some((x) => x.id === r.job_id);
function from(t: string) {
  reads.push(t);
  let rows = [...(tables[t] ?? [])];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (cols: string) => { if (/jobs!inner/.test(cols ?? "")) rows = rows.filter(hasJob); return q; },
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => val(r, k) === v); return q; },
    neq: (k: string, v: unknown) => { rows = rows.filter((r) => val(r, k) !== v); return q; },
    is: (k: string, v: unknown) => { rows = rows.filter((r) => (val(r, k) ?? null) === v); return q; },
    not: (k: string, op: string, v: unknown) => {
      if (op !== "in") throw new Error(`fake: not ${op}`);
      const list = String(v).replace(/^\(|\)$/g, "").split(",");
      rows = rows.filter((r) => !list.includes(String(val(r, k))));
      return q;
    },
    limit: () => q,
    insert: () => { writes.push(t); return q; },
    update: () => { writes.push(t); return q; },
    delete: () => { writes.push(t); return q; },
    maybeSingle: async () => (t === "workflow_settings" && readError ? { data: null, error: readError } : { data: rows[0] ?? null, error: null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
const syncCalls: unknown[][] = [];
let syncThrows: Error | null = null;
mock.module("../src/lib/mitti.server", () => ({
  syncMittiAssessment: async (...a: unknown[]) => { syncCalls.push(a); if (syncThrows) throw syncThrows; return { locked: false, completed: false, issues: [] }; },
}));
const { handleMittiNotice } = await import("../src/lib/mitti-webhook.server");

beforeEach(() => {
  reads.length = 0; writes.length = 0; syncCalls.length = 0; syncThrows = null; readError = null;
  tables = {
    workflow_settings: [{ id: 1, mitti_instant_notice_enabled: true }],
    assessments: [{ job_id: "job-a", external_mitti_id: "audit_a", status: "in_progress" }],
    ceiling_measurements: [
      { job_id: "job-m", external_source: "mitti", is_current: true, external_id: "audit_m", status: "draft" },
      { job_id: "job-old", external_source: "mitti", is_current: false, external_id: "audit_old", status: "draft" },
      { job_id: "job-x", external_source: "other", is_current: true, external_id: "audit_x", status: "draft" },
    ],
    jobs: ["job-a", "job-m", "job-old", "job-x"].map((id) => ({ id, business_unit: "hivic", stage: "ready_check", deleted_at: null, qa_archived_at: null })),
  };
});

describe("handleMittiNotice", () => {
  test("unknown audit id is ignored, sync not called", async () => {
    expect(await handleMittiNotice("audit_nope")).toEqual({ action: "ignored" });
    expect(syncCalls).toHaveLength(0);
  });
  test("non-current or non-Mitti measurement rows are ignored", async () => {
    expect((await handleMittiNotice("audit_old")).action).toBe("ignored");
    expect((await handleMittiNotice("audit_x")).action).toBe("ignored");
    expect(syncCalls).toHaveLength(0);
  });
  test("switch off (false) returns off without doing the lookups", async () => {
    tables.workflow_settings = [{ id: 1, mitti_instant_notice_enabled: false }];
    expect(await handleMittiNotice("audit_a")).toEqual({ action: "off" });
    expect(syncCalls).toHaveLength(0);
    expect(reads).toEqual(["workflow_settings"]);
  });
  test("switch row missing is off", async () => {
    tables.workflow_settings = [];
    expect((await handleMittiNotice("audit_a")).action).toBe("off");
    expect(syncCalls).toHaveLength(0);
  });
  test("read error such as column not found is off", async () => {
    readError = { message: "column workflow_settings.mitti_instant_notice_enabled does not exist" };
    expect((await handleMittiNotice("audit_a")).action).toBe("off");
    expect(syncCalls).toHaveLength(0);
  });
  test("audit on an assessment with switch on is synced once with (jobId, null)", async () => {
    expect(await handleMittiNotice("audit_a")).toEqual({ action: "synced" });
    expect(syncCalls).toEqual([["job-a", null]]);
  });
  test("audit only on a current Mitti measurement is synced", async () => {
    expect(await handleMittiNotice("audit_m")).toEqual({ action: "synced" });
    expect(syncCalls).toEqual([["job-m", null]]);
  });
  test("sync throwing returns failed, logs ids and message only, does not throw", async () => {
    syncThrows = new Error("Mitti is down");
    const logged: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logged.push(a); };
    try {
      expect(await handleMittiNotice("audit_a")).toEqual({ action: "failed" });
    } finally { console.error = orig; }
    expect(logged).toEqual([["mitti notice: sync failed", "job-a", "Mitti is down"]]);
  });
  // Same scope as the 15-minute pull (syncPendingMitti): a job it never syncs is ignored by the notice too.
  const setJob = (id: string, patch: Row) => { tables.jobs = tables.jobs!.map((j) => (j.id === id ? { ...j, ...patch } : j)); };
  test("a deleted or archived job is ignored; nothing synced, nothing written", async () => {
    setJob("job-a", { deleted_at: "2026-10-01T00:00:00Z" });
    expect(await handleMittiNotice("audit_a")).toEqual({ action: "ignored" });
    setJob("job-a", { deleted_at: null, qa_archived_at: "2026-10-01T00:00:00Z" });
    expect(await handleMittiNotice("audit_a")).toEqual({ action: "ignored" });
    expect(syncCalls).toEqual([]);
    expect(writes).toEqual([]);
  });
  for (const stage of ["cancelled", "on_hold", "complete", "ready_for_veec"]) {
    test(`a ${stage} job is ignored (assessment and measurement lookups)`, async () => {
      setJob("job-a", { stage });
      setJob("job-m", { stage });
      expect(await handleMittiNotice("audit_a")).toEqual({ action: "ignored" });
      expect(await handleMittiNotice("audit_m")).toEqual({ action: "ignored" });
      expect(syncCalls).toEqual([]);
    });
  }
  test("a job outside the hivic business unit is ignored", async () => {
    setJob("job-a", { business_unit: "canberra" });
    expect((await handleMittiNotice("audit_a")).action).toBe("ignored");
    expect(syncCalls).toEqual([]);
  });
  test("a complete assessment or measurement row is ignored", async () => {
    tables.assessments = [{ job_id: "job-a", external_mitti_id: "audit_a", status: "complete" }];
    tables.ceiling_measurements = [{ job_id: "job-m", external_source: "mitti", is_current: true, external_id: "audit_m", status: "complete" }];
    expect((await handleMittiNotice("audit_a")).action).toBe("ignored");
    expect((await handleMittiNotice("audit_m")).action).toBe("ignored");
    expect(syncCalls).toEqual([]);
  });
  test("a normal open job is still synced", async () => {
    setJob("job-a", { stage: "quote" });
    expect((await handleMittiNotice("audit_a")).action).toBe("synced");
    expect(syncCalls).toEqual([["job-a", null]]);
  });
});
