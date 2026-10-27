// Mitti instant notice (one audit id) against an in-memory fake database and a mocked syncMittiAssessment:
// no network, no real database. Switch is read first; lookups by assessment, then current Mitti measurement.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let readError: { message: string } | null = null;
const reads: string[] = [];
const writes: string[] = [];
function from(t: string) {
  reads.push(t);
  let rows = [...(tables[t] ?? [])];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
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
    assessments: [{ job_id: "job-a", external_mitti_id: "audit_a" }],
    ceiling_measurements: [
      { job_id: "job-m", external_source: "mitti", is_current: true, external_id: "audit_m" },
      { job_id: "job-old", external_source: "mitti", is_current: false, external_id: "audit_old" },
      { job_id: "job-x", external_source: "other", is_current: true, external_id: "audit_x" },
    ],
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
  test("a deleted or archived job still reaches sync (its own guard does nothing); the notice writes nothing", async () => {
    tables.jobs = [{ id: "job-a", deleted_at: "2026-10-01T00:00:00Z", qa_archived_at: null }];
    expect(await handleMittiNotice("audit_a")).toEqual({ action: "synced" });
    expect(syncCalls).toEqual([["job-a", null]]);
    expect(writes).toEqual([]);
  });
});
