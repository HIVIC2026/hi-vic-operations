// Batch 1 task 2: the initial PIESA (Complete PIESA / A3) marks the confirmed safety-check visit done, so the electrician's
// pay line shows in the office Payouts (moneyPayouts only lists assessment lines for completed assessment bookings before Final check).
import { describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function from(table: string) {
  let rows = [...(tables[table] ?? [])];
  let patch: Row | null = null;
  let count = false;
  const apply = () => { if (patch) for (const r of tables[table] ?? []) if (rows.includes(r)) Object.assign(r, patch); };
  const b: Record<string, any> = {
    select: (_c?: string, o?: { head?: boolean }) => { count = !!o?.head; return b; },
    update: (p: Row) => { patch = p; return b; },
    insert: async (p: Row) => { (tables[table] ??= []).push(p); return { data: null, error: null }; },
    eq: (c: string, v: unknown) => { rows = rows.filter((r) => !(c in r) || r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { rows = rows.filter((r) => !(c in r) || v.includes(r[c])); return b; },
    neq: () => b, is: () => b, not: () => b, order: () => b, limit: () => b, gte: () => b, lt: () => b, contains: () => b,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => { apply(); return r(count ? { count: rows.length, data: null, error: null } : { data: rows, error: null }); },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError, logEvent: async () => {}, stageEntryBlockers: async () => [], transition: async () => {}, getStage: async () => "piesa_scheduled",
}));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null }));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "ceiling", label: "ceiling" }), advanceSiteRequirements: async () => ({ advanced: false, scope: "ceiling" }) }));
mock.module("../src/lib/install-clearance.server", () => ({ notifyInstallerClearance: async () => {} }));
mock.module("../src/lib/trade-payout-gate.server", () => ({
  safetyVisitFacts: async () => new Map(), // batch 1 F5 (per-visit safety check pay)
  payoutGateFacts: async (ids: string[]) => new Map(ids.map((id) => [id, { piesa: { mittiForm: false, completed: true, evidence: [], completedAt: "2026-10-01T02:00:00Z" }, fixes: null, install: null }])),
}));
const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
const { moneyPayouts } = await import("../src/lib/office-money.server");

function seed(bookingStatus: string) {
  tables["assessments"] = [{ id: "a1", job_id: "j1", status: "in_progress", piesa_outcome: "pass", assessed_on: "2026-10-01", life_support_confirmed: true, switchboard_condition: "ok", rcds_present: true, no_rectification_confirmed: true, external_mitti_id: null, assessor_id: "u1" }];
  tables["piesa_records"] = []; tables["evidence_requirements"] = []; tables["rectification_items"] = [];
  tables["bookings"] = [
    { id: "b1", job_id: "j1", kind: "assessment", status: bookingStatus },
    { id: "b2", job_id: "j1", kind: "installation", status: "confirmed" },
    { id: "b3", job_id: "j2", kind: "assessment", status: "confirmed" },
  ];
  tables["jobs"] = [{ id: "j1", job_number: "HV-0001", stage: "piesa_complete", source: "website", channel: "hivic_sourced", electrician_choice: null, installation_completed_at: null, deleted_at: null, owners: { full_name: "Owner" } }];
  tables["job_assignments"] = [{ job_id: "j1", business_id: "e1", role: "electrician", active: true, businesses: { name: "Sparky Co", trading_name: null } }];
  tables["quotes"] = []; tables["quote_internals"] = []; tables["workflow_events"] = []; tables["invoices"] = [];
  tables["pricing_settings"] = [{ piesa_rec_cost_ex_gst: 300, gst_rate: 0.1, is_active: true }];
  tables["electrician_rates"] = [];
}

describe("initial PIESA completion marks the safety check visit done", () => {
  test("before: a confirmed assessment booking gives no electrician pay line", async () => {
    seed("confirmed");
    const r = await moneyPayouts();
    expect([...r.due, ...r.held].filter((l) => l.kind === "assessment")).toEqual([]);
  });
  test("after Complete PIESA: that job's confirmed assessment booking is completed, others untouched, and the pay line appears", async () => {
    seed("confirmed");
    await completePiesaAssessment({ jobId: "j1" }, "u1");
    const st = (id: string) => tables["bookings"]!.find((b) => b.id === id)!.status;
    expect(st("b1")).toBe("completed");
    expect(st("b2")).toBe("confirmed");
    expect(st("b3")).toBe("confirmed");
    expect(tables["piesa_records"]![0]).toMatchObject({ kind: "initial", job_id: "j1" });
    const r = await moneyPayouts();
    const lines = [...r.due, ...r.held].filter((l) => l.kind === "assessment");
    expect(lines.map((l) => [l.jobId, l.business])).toEqual([["j1", "Sparky Co"]]);
  });
});

describe("readers that print the safety check date after completion accept a completed booking", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const lineWith = (file: string, needle: string) => readFileSync(file, "utf8").split("\n").find((l) => l.includes(needle) && l.includes('"kind", "assessment"'))!;
  test("official PIESA form data (mitti.server) and installer job panels (trade-view.server)", () => {
    for (const [f, n] of [["src/lib/mitti.server.ts", 'select("scheduled_start,status")'], ["src/lib/trade-view.server.ts", 'select("scheduled_start").eq("job_id", jobId)']] as const) {
      const l = lineWith(f, n);
      expect(l).toContain('.in("status", ["confirmed", "completed"])');
      expect(l).not.toContain('.eq("status", "confirmed")');
    }
  });
});
