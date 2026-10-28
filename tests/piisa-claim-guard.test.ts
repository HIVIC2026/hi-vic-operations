// Task 1 (Mitti form retry): the install-day form (createPiisaMittiAudit) uses the same atomic claim guard as the
// Ready Check / PIESA forms: one create per job, a lost reply is recorded as uncertain and never auto-retried, and the
// hourly sender skips a held claim instead of logging a new failure each hour. Real createPiisaMittiAudit,
// sweepPiisaAutoSend and claim code; fake Mitti (no network); in-memory admin DB enforcing the workflow_events primary
// key like Postgres. Fictional data only.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

// ---------- in-memory admin client (PK-enforcing for workflow_events) ----------
type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
const clock = { now: Date.now() };
/** Make every held claim look `ms` older (the office-override age check uses the real clock). */
const ageClaims = (ms: number) => { for (const e of T.workflow_events ?? []) if (e.event_type === "mitti_audit_create_started") e.created_at = new Date(Date.parse(String(e.created_at)) - ms).toISOString(); };
let seq = 0;
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let values: unknown = null; let head = false; let wantCount = false;
  const f: [string, string, unknown][] = [];
  const match = (r: Row) => f.every(([k, kind, v]) => kind === "eq" ? r[k] === v : kind === "in" ? (v as unknown[]).includes(r[k]) : kind === "is" ? (r[k] ?? null) === v : true);
  const rows = () => (T[table] ??= []);
  const run = () => {
    if (op === "insert") {
      const list = (Array.isArray(values) ? values : [values]) as Row[];
      for (const r of list) if (r.id && rows().some((x) => x.id === r.id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      const added = list.map((r) => ({ id: r.id ?? `${table}-${++seq}`, created_at: new Date(clock.now).toISOString(), ...r }));
      rows().push(...added); return { data: added, error: null };
    }
    if (op === "update") { const hit = rows().filter(match); for (const r of hit) Object.assign(r, values as Row); return { data: hit, error: null }; }
    const hit = rows().filter(match);
    return { data: head ? null : hit, error: null, count: wantCount ? hit.length : null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { head = !!o?.head; wantCount = !!o?.count; return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    neq: () => q, not: () => q, gte: () => q, gt: () => q, lt: () => q, lte: () => q, contains: () => q, order: () => q, limit: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) } } }));
const realOfficialCore = await import("../src/lib/official-forms.core");
mock.module("../src/lib/official-forms.core", () => ({ ...realOfficialCore, officialFormUseBlocker: () => null }));
mock.module("../src/lib/official-forms.server", () => ({ officialPrefillContext: async () => ({}) }));
mock.module("../src/lib/official-prefill.core", () => ({ piisaPrefill: () => [] }));
mock.module("../src/lib/piisa-ap.core", () => ({ ensurePiisaAp: async () => undefined }));
mock.module("../src/lib/prestart.server", () => ({ requirePrestartClear: async () => undefined, prestartGate: async () => ({ locked: false, reasons: [] }) }));

const { createPiisaMittiAudit } = await import("../src/lib/mitti.server");
const { MittiClaimHeld, MittiOutcomeUncertain } = await import("../src/lib/mitti-create.server");
const { sweepPiisaAutoSend } = await import("../src/lib/piisa-autosend.server");
const { CLAIM_EVENT, RELEASE_EVENT, UNCERTAIN_EVENT } = await import("../src/lib/mitti-create-claim.core");
const { PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_FAILED_EVENT } = await import("../src/lib/piisa-autosend.core");

// ---------- fake Mitti ----------
const A2_UUID = "dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39";
const TEMPLATE = { template: { template_id: "template_dbaf67a2c9c541208c690f4a43c5bd39", name: "TEST install day", items: [
  { item_id: "job", label: "Portal Job Number", type: "textsingle" }, { item_id: "address", label: "Site address", type: "address" },
] } };
type Behaviour = { create?: "ok" | "timeout"; search?: "ok" | "none" };
function fakeMitti(b: Behaviour = {}) {
  const calls: string[] = []; let n = 0;
  const call = async (method: string, path: string): Promise<unknown> => {
    calls.push(`${method} ${path}`);
    if (path === "/users/search") return { users: b.search === "none" ? [] : [{ id: "user_9", email: "ivan@hivic-local.test" }] };
    if (path.startsWith("/templates/")) return TEMPLATE;
    if (method === "GET" && path.startsWith("/audits/")) return { audit_id: path.slice("/audits/".length), template_id: TEMPLATE.template.template_id, header_items: [{ item_id: "job", label: "Portal Job Number", responses: { text: "HV-9002" } }], items: [] };
    if (path === "/audits") { if (b.create === "timeout") throw new Error("Mitti could not be reached. Try again shortly."); return { audit_id: `audit_${++n}` }; }
    if (path.endsWith("/share") || path.endsWith("/owner")) return {};
    throw new Error("unexpected " + path);
  };
  return { call: call as never, calls, creates: () => calls.filter((c) => c === "POST /audits").length };
}

const JOB = "a0000000-0000-4000-8000-0000000000f2";
const INSTALLER = "a0000000-0000-4000-8000-000000000003";
const events = (type?: string) => (T.workflow_events ?? []).filter((e) => !type || e.event_type === type);
const NOW = new Date("2026-11-02T03:00:00Z");

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  clock.now = Date.now();
  Object.assign(T, {
    jobs: [{ id: JOB, job_number: "HV-9002", business_unit: "hivic", stage: "installation_booked", source: "web" }],
    job_assignments: [{ job_id: JOB, role: "installer", active: true, user_id: INSTALLER, profiles: { email: "ivan@hivic-local.test" } }],
    workflow_settings: [{ id: 1, mitti_piisa_template_id: A2_UUID }],
    bookings: [{ id: "b1", job_id: JOB, kind: "installation", status: "confirmed", scheduled_start: "2026-11-02T22:00:00Z" }],
    workflow_events: [{ id: "e-rc", job_id: JOB, event_type: "stage_changed", to_stage: "ready_check_complete" }],
  });
});

describe("install-day form claim guard", () => {
  test("install_day timeout records uncertain and a second call does not create", async () => {
    const m = fakeMitti({ create: "timeout" });
    await expect(createPiisaMittiAudit(JOB, null, m.call)).rejects.toBeInstanceOf(MittiOutcomeUncertain);
    expect(m.creates()).toBe(1);
    const unc = events(UNCERTAIN_EVENT);
    expect(unc.length).toBe(1);
    expect((unc[0]!.details as { kind: string }).kind).toBe("install_day");
    await expect(createPiisaMittiAudit(JOB, null, m.call)).rejects.toBeInstanceOf(MittiClaimHeld);
    expect(m.creates()).toBe(1);
  });
  test("install_day not_created releases claim", async () => {
    const m = fakeMitti({ search: "none" });
    await expect(createPiisaMittiAudit(JOB, null, m.call)).rejects.toThrow("was not found in Mitti");
    expect(m.creates()).toBe(0);
    const rel = events(RELEASE_EVENT);
    expect(rel.length).toBe(1);
    expect((rel[0]!.details as { kind: string }).kind).toBe("install_day");
    // a later attempt can claim again (released, not held)
    const ok = fakeMitti();
    await createPiisaMittiAudit(JOB, null, ok.call);
    expect(ok.creates()).toBe(1);
  });
  test("install_day with existing piisa event does not claim", async () => {
    T.workflow_events!.push({ id: "e-prev", job_id: JOB, event_type: PIISA_AUDIT_CREATED_EVENT, details: { audit_id: "audit_old" } });
    const calls: string[] = [];
    const call = (async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (path === "/users/search") return { users: [{ id: "user_9", email: "ivan@hivic-local.test" }] };
      if (path === "/audits/audit_old") return { audit_id: "audit_old", template_id: TEMPLATE.template.template_id, header_items: [{ item_id: "job", label: "Portal Job Number", responses: { text: "HV-9002" } }], items: [] };
      return {};
    }) as never;
    const r = await createPiisaMittiAudit(JOB, null, call);
    expect(r.reused).toBe(true);
    expect(events(CLAIM_EVENT).length).toBe(0);
    expect(calls.includes("POST /audits")).toBe(false);
  });
  test("install_day success", async () => {
    const m = fakeMitti();
    const r = await createPiisaMittiAudit(JOB, null, m.call);
    expect(r).toMatchObject({ auditId: "audit_1", reused: false });
    expect(events(PIISA_AUDIT_CREATED_EVENT).length).toBeGreaterThan(0);
    expect(events(CLAIM_EVENT).length).toBe(1);
    expect((events(CLAIM_EVENT)[0]!.details as { kind: string }).kind).toBe("install_day");
    expect(events(RELEASE_EVENT).length).toBe(0); // claim stays held, like the other kinds
    await expect(createPiisaMittiAudit(JOB, null, m.call)).resolves.toMatchObject({ reused: true }); // later calls reuse, never claim
    expect(m.creates()).toBe(1);
  });
});

describe("hourly install-day sender", () => {
  test("autosend skips held install_day claim", async () => {
    // an earlier attempt left the claim held (uncertain)
    const m = fakeMitti({ create: "timeout" });
    await expect(createPiisaMittiAudit(JOB, null, m.call)).rejects.toBeInstanceOf(MittiOutcomeUncertain);
    const before = events().length;
    const out = await sweepPiisaAutoSend({ now: NOW });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.outcome).toBe("skipped");
    expect(events(PIISA_AUTOSEND_FAILED_EVENT).length).toBe(0);
    expect(events().length).toBe(before); // nothing new logged
  });
});

describe("C3: the office can take over a lost-reply install-day form", () => {
  test("the creator supersedes a lost-reply claim (after 10 minutes) only with the office override, recorded", async () => {
    const m = fakeMitti({ create: "timeout" });
    await expect(createPiisaMittiAudit(JOB, null, m.call)).rejects.toBeInstanceOf(MittiOutcomeUncertain);
    ageClaims(11 * 60_000);
    const ok = fakeMitti();
    await expect(createPiisaMittiAudit(JOB, "office-1", ok.call)).rejects.toBeInstanceOf(MittiClaimHeld); // without the override: stuck
    await expect(createPiisaMittiAudit(JOB, "office-1", ok.call, { officeOverride: true })).resolves.toMatchObject({ reused: false });
    expect(ok.creates()).toBe(1);
    expect(events("mitti_audit_create_office_override").length).toBe(1);
  });
  test("the office 'send to installer' button passes the office override", () => {
    const src = readFileSync("src/lib/official-forms.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const sendPiisaToInstaller"));
    expect(fn).toContain("createPiisaMittiAudit(data.jobId, context.userId, realMittiCall, { officeOverride: true })");
  });
});

