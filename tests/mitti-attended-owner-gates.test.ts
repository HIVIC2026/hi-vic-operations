// Jo 1 Nov 2026: Attended = Yes written by a finished Mitti Ready Check does NOT add the owner's "Earlier visit"
// (visit_permission) Gate B item or an office "Owner paperwork B" flag; a hand-set attended answer still does.
import { describe, expect, mock, test } from "bun:test";
import { evaluateOwnerGates, installerVisitFromAttendance, type GateFacts } from "../src/lib/owner-gates.core";

const MITTI = { event_type: "installer_attended_from_mitti", created_at: "2026-10-28T00:00:00Z" };
const handAt = (at: string, answer = "attended") => ({ event_type: "installer_attendance_answer", created_at: at, details: { answer } });

describe("installerVisitFromAttendance", () => {
  test("hand-set yes, no Mitti event: earlier visit", () => expect(installerVisitFromAttendance("yes", [])).toBe(true));
  test("yes from Mitti: not an earlier visit", () => expect(installerVisitFromAttendance("yes", [MITTI])).toBeNull());
  test("yes from Mitti, hand answer BEFORE it: still not", () => expect(installerVisitFromAttendance("yes", [handAt("2026-10-20T00:00:00Z"), MITTI])).toBeNull());
  test("yes from Mitti, installer answered by hand AFTER it: earlier visit", () => expect(installerVisitFromAttendance("yes", [MITTI, handAt("2026-10-29T00:00:00Z")])).toBe(true));
  test("no / unset / odd values unchanged", () => {
    expect(installerVisitFromAttendance("no", [MITTI])).toBe(false);
    expect(installerVisitFromAttendance(null, [MITTI])).toBeNull();
    expect(installerVisitFromAttendance("visited", [])).toBeNull();
  });
});

const facts = (visitedByInstaller: boolean | null): GateFacts => ({ isTest: false, signed: [], approved: {}, tenant: false, lifeSupport: false, visitedByInstaller, hasQuote: true,
  agreementSigned: true, agreementWordingApproved: true, escConsentSigned: true, piesaCopyDelivered: true, piesaDeclarationMappingApproved: false, assignmentEffective: true });
const hasVisitItem = (v: boolean | null) => evaluateOwnerGates(facts(v)).find((g) => g.gate === "B")!.items.some((i) => i.key === "visit_permission");

test("owner-gates.core: Mitti yes → no Earlier visit item; hand yes → item", () => {
  expect(hasVisitItem(installerVisitFromAttendance("yes", [MITTI]))).toBe(false);
  expect(hasVisitItem(installerVisitFromAttendance("yes", []))).toBe(true);
});

// ---- the real readers (owner-gates.server gateFacts + office.server loadOffice) on an in-memory fake database ----
const JM = "00000000-0000-4000-8000-0000000000a1", JH = "00000000-0000-4000-8000-0000000000a2";
const job = (id: string, n: string) => ({ id, job_number: n, source: "hivic", channel: "installer_sourced", stage: "awaiting_deposit_payment", installer_site_check: "yes",
  life_support: false, life_support_status: null, created_at: "2026-10-20T00:00:00Z", last_activity_at: "2026-10-20T00:00:00Z", qa_archived_at: null, deleted_at: null,
  owners: { full_name: "Owner" }, properties: { suburb: "X", postcode: "3000" } });
const tables: Record<string, Record<string, unknown>[]> = {
  jobs: [job(JM, "HV-T1"), job(JH, "HV-T2")],
  workflow_events: [{ job_id: JM, ...MITTI }],
  workflow_settings: [{ id: 1, office_time_limits: {} }],
};
let failTable: string | null = null;
function from(table: string) {
  const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  let mode: "one" | "maybe" | null = null, head = false, lo = 0, hi = Infinity, lim = Infinity;
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return b; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return b; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return b; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return b; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return b; },
    not: () => b, or: () => b, order: () => b, contains: () => b, gte: () => b, lte: () => b, lt: () => b, gt: () => b, filter: () => b, like: () => b, ilike: () => b,
    range: (a: number, z: number) => { lo = a; hi = z; return b; },
    limit: (n: number) => { lim = n; return b; },
    single: () => { mode = "one"; return b; }, maybeSingle: () => { mode = "maybe"; return b; },
    update: () => { throw new Error(`unexpected write ${table}`); }, insert: () => { throw new Error(`unexpected write ${table}`); },
    then: (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve().then(() => {
      if (table === failTable) return { data: null, count: null, error: { message: "read unavailable" } };
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(lo, hi + 1).slice(0, lim);
      return { data: head ? null : mode ? rows[0] ?? null : rows, count: rows.length, error: null };
    }).then(ok, no),
  };
  return b;
}
const admin = { from, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) } };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, agreementSigned: async () => true, assignmentStatus: async () => "effective_complete" }));
mock.module("../src/lib/job-records.server", () => ({ lifeSupportPlansOnFile: async () => new Set<string>() }));

describe("readers", () => {
  test("gateFacts: Mitti-set yes has no Earlier visit; hand-set yes still has it", async () => {
    const { ownerGates } = await import("../src/lib/owner-gates.server");
    const m = await ownerGates(JM);
    expect(m.facts.visitedByInstaller).toBeNull();
    expect(m.gates.find((g) => g.gate === "B")!.items.some((i) => i.key === "visit_permission")).toBe(false);
    const h = await ownerGates(JH);
    expect(h.facts.visitedByInstaller).toBe(true);
    expect(h.gates.find((g) => g.gate === "B")!.items.some((i) => i.key === "visit_permission")).toBe(true);
  });
  test("gateFacts: a failed attendance-source read fails closed (no invented visit facts)", async () => {
    const { gateFacts } = await import("../src/lib/owner-gates.server");
    failTable = "workflow_events";
    try { await expect(gateFacts(JM)).rejects.toThrow(/could not load/); } finally { failTable = null; }
  });
  test("loadOffice: no Owner paperwork Earlier visit flag for the Mitti job; still flagged for the hand-set job", async () => {
    const { loadOffice } = await import("../src/lib/office.server");
    const r = await loadOffice(admin as never, { includeTest: true, onlyIds: [JM, JH] });
    const fails = (id: string) => r.jobs.find((j) => j.id === id)!.needs.failures;
    expect(fails(JM).some((x) => /Earlier visit/.test(x))).toBe(false);
    expect(fails(JH).some((x) => /Earlier visit/.test(x))).toBe(true);
  });
});
