// Step 10 locks against an in-memory fake database (no network, no real writes):
// - the server gate used by the installer safety form (Mitti) and installation evidence uploads
// - both callers really use it, before any send/upload
// - recording the ESC submission re-runs the pre-start check straight away
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  let rows = [...(tables[t] ?? [])];
  let op = "select";
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { if (op === "select") rows = rows.filter((r) => r[k] === v); return q; },
    neq: () => q, in: () => q, not: () => q, is: () => q, gt: () => q, lt: () => q,
    order: (k: string, o?: { ascending?: boolean }) => { rows.sort((a, b) => String(a[k] ?? "").localeCompare(String(b[k] ?? "")) * (o?.ascending === false ? -1 : 1)); return q; },
    limit: (n: number) => { rows = rows.slice(0, n); return q; },
    update: () => { op = "update"; return q; }, insert: () => { op = "insert"; return q; },
    maybeSingle: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: null }),
    single: async () => ({ data: op === "select" ? rows[0] ?? null : null, error: rows[0] ? null : { message: "none" } }),
    then: (res: (v: unknown) => unknown) => res({ data: op === "select" ? rows : null, error: null, count: op === "select" ? rows.length : null }),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));

const runs: { jobId: string; trigger: string }[] = [];
const realPrestart = await import("../src/lib/prestart.server");
const { prestartRunAt } = await import("../src/lib/prestart.core");

const J = "job-1";
const H = 3_600_000;
function seed(startInHours: number, check: { passed: boolean; failures: string[] } | null) {
  const start = new Date(Date.now() + startInHours * H).toISOString();
  tables = {
    bookings: [{ id: "bk", job_id: J, kind: "installation", status: "confirmed", scheduled_start: start, assignment_id: "a1", created_at: "2026-01-01" }],
    pre_start_checks: check ? [{ job_id: J, scheduled_start: start, passed: check.passed, failures: check.failures, checked_at: "2026-01-02" }] : [],
  };
  return start;
}

describe("pre-start lock (server gate for safety form + install evidence)", () => {
  beforeEach(() => { tables = {}; });
  test("failed check locks with its reasons", async () => {
    seed(10, { passed: false, failures: ["ESC notification not submitted."] });
    await expect(realPrestart.requirePrestartClear(J)).rejects.toThrow("Not cleared to start: ESC notification not submitted.");
  });
  test("no check yet after 12pm the day before locks", async () => {
    const start = seed(2, null);
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(prestartRunAt(start)));
    await expect(realPrestart.requirePrestartClear(J)).rejects.toThrow("has not run yet");
  });
  test("passed check clears", async () => {
    seed(10, { passed: true, failures: [] });
    await expect(realPrestart.requirePrestartClear(J)).resolves.toBeUndefined();
  });
  test("open 'Site conditions differ' hold locks even a passed check", async () => {
    seed(10, { passed: true, failures: [] });
    tables.workflow_events = [{ job_id: J, event_type: "site_conditions_differ_raised", created_at: "2026-10-20T01:00:00Z", details: { note: "Extra void" } }];
    await expect(realPrestart.requirePrestartClear(J)).rejects.toThrow("Site conditions differ — office review required before the quote or works can continue: Extra void");
  });
  test("no install booked: nothing to lock", async () => {
    await expect(realPrestart.requirePrestartClear(J)).resolves.toBeUndefined();
  });
});

describe("both callers use the gate before acting", () => {
  test("installer safety form: gate runs before the Mitti audit is created", () => {
    const src = readFileSync(new URL("../src/lib/mitti.server.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("export async function createPiisaMittiAudit"));
    const gate = fn.indexOf("requirePrestartClear(jobId)");
    expect(gate).toBeGreaterThan(0);
    for (const later of ["workflow_events\").insert", "mittiFetch", "fetch("]) {
      const i = fn.indexOf(later);
      if (i > 0) expect(gate).toBeLessThan(i);
    }
  });
  test("evidence: request and confirm both lock installation categories before storage work", () => {
    const src = readFileSync(new URL("../src/lib/portal.functions.ts", import.meta.url), "utf8");
    for (const name of ["requestEvidenceUpload", "confirmEvidenceUpload"]) {
      const body = src.slice(src.indexOf(`export const ${name}`)).split("export const ")[1]!;
      const gate = body.indexOf("requirePrestartClear(req.job_id)");
      expect(gate).toBeGreaterThan(0);
      expect(body.slice(0, gate)).toContain("INSTALL_EVIDENCE_CATEGORIES.includes(req.category)");
      const storage = body.indexOf(".storage");
      if (storage > 0) expect(gate).toBeLessThan(storage);
    }
  });
});

describe("ESC submission re-runs the pre-start check", () => {
  test("recording the submission triggers runPrestart('esc_submitted') straight away", async () => {
    mock.module("../src/lib/prestart.server", () => ({ ...realPrestart, runPrestart: async (jobId: string, trigger: string) => { runs.push({ jobId, trigger }); return null; } }));
    mock.module("../src/lib/consent.server", () => ({ currentConsent: async () => null }));
    const realEsc = await import("../src/lib/esc.core");
    mock.module("../src/lib/esc.core", () => ({ ...realEsc, submissionBlockers: () => [] }));
    const start = new Date(Date.now() + 3 * 24 * H).toISOString();
    tables = { esc_notifications: [{ id: "n1", job_id: J, status: "ready", consent_id: "c1", scheduled_start: start, payload_json: {} }], workflow_events: [], jobs: [{ id: J }] };
    const { recordEscSubmission } = await import("../src/lib/esc.server");
    await recordEscSubmission({ notificationId: "n1", reference: "ESC-TEST-123", sentAt: new Date().toISOString(), method: "manual_portal", confirmed: true, actorId: "u1" }).catch(() => undefined);
    expect(runs).toContainEqual({ jobId: J, trigger: "esc_submitted" });
  });
});
