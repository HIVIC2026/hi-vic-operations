// T3 acceptance: Mitti form creation is asynchronous, started by a confirmed Ready Check booking, protected by an
// atomic per-job/per-form claim, never triggered by status polls, and never blindly repeated after an uncertain
// outcome. Real createAssignMittiAudit / createOrReuseAudit / onsite + background code; fake Mitti (no network),
// in-memory admin DB whose workflow_events primary key is enforced like Postgres. Fictional data only.
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
    neq: () => q, not: () => q, gte: () => q, gt: () => q, lte: () => q, contains: () => q, order: () => q, limit: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }; },
    single: async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] ?? null : r.data; return { data: d, error: r.error ?? (d ? null : { message: "none" }) }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) } } }));
mock.module("../src/lib/owner-gates.server", () => ({ gateAComplete: async () => true }));
const realPilot = await import("../src/lib/pilot.server");
mock.module("../src/lib/pilot.server", () => ({ ...realPilot, requireMember: async () => undefined }));
mock.module("../src/lib/requirements.server", () => ({
  jobScope: async (jobId: string) => ({ scope: "MEASURE_UP_ONLY", label: "Ready Check", measurementRow: (T.ceiling_measurements ?? []).find((m) => m.job_id === jobId && m.is_current) ?? null }),
}));

const { MITTI_TEMPLATE_ID } = await import("../src/lib/mitti.core");
const { createAssignMittiAudit, realMittiCall } = await import("../src/lib/mitti.server");
const C = await import("../src/lib/mitti-create.server");
const { onsiteFormFor } = await import("../src/lib/onsite-ready-check.server");
const { claimEventId, CLAIM_EVENT, RELEASE_EVENT, UNCERTAIN_EVENT, OFFICE_OVERRIDE_EVENT } = await import("../src/lib/mitti-create-claim.core");

// ---------- fake Mitti ----------
const TEMPLATE = {
  template_id: MITTI_TEMPLATE_ID,
  header_items: [
    { item_id: "h1", label: "Portal Job Number", type: "text" }, { item_id: "h2", label: "Site address", type: "address" },
    { item_id: "h3", label: "Owner name", type: "text" }, { item_id: "h4", label: "Owner email", type: "text" },
    { item_id: "h5", label: "Assigned Electrician / Assessor", type: "text" }, { item_id: "h6", label: "Assessment date/time", type: "datetime" },
  ],
  items: [{ item_id: "s1", label: "Office details", type: "section" }, { item_id: "i1", parent_id: "s1", label: "Office estimated ceiling area (m²)", type: "text" }],
};
type Behaviour = { create?: "ok" | "timeout" | "no_id" | "hang"; search?: "ok" | "timeout"; share?: "ok" | "fail" };
function fakeMitti(b: Behaviour = {}) {
  const calls: string[] = []; let n = 0; let release: (() => void) | null = null;
  const gate = new Promise<void>((r) => { release = r; });
  const call = async (method: string, path: string): Promise<unknown> => {
    calls.push(`${method} ${path}`);
    if (path === "/users/search") { if (b.search === "timeout") throw new Error("Mitti could not be reached. Try again shortly."); return { users: [{ id: "user_9", email: "ivan@hivic-local.test" }] }; }
    if (path.startsWith("/templates/")) return TEMPLATE;
    if (method === "GET" && path.startsWith("/audits/")) return {
      audit_id: decodeURIComponent(path.slice("/audits/".length)), template_id: MITTI_TEMPLATE_ID,
      header_items: [{ item_id: "h1", label: "Portal Job Number", responses: { text: "HV-9001" } }], items: [],
    };
    if (path === "/audits") {
      if (b.create === "hang") await gate;
      if (b.create === "timeout") throw new Error("Mitti could not be reached. Try again shortly.");
      if (b.create === "no_id") return {};
      return { audit_id: `audit_${++n}` };
    }
    if (path.endsWith("/share") || path.endsWith("/owner")) { if (b.share === "fail") throw new Error("Mitti request failed (500)."); return {}; }
    throw new Error("unexpected " + path);
  };
  return { call: call as never, calls, creates: () => calls.filter((c) => c === "POST /audits").length, release: () => release?.() };
}

const JOB = "a0000000-0000-4000-8000-0000000000f1";
const BIZ = "a0000000-0000-4000-8000-000000000011";
const INSTALLER = "a0000000-0000-4000-8000-000000000003";
const ASSIGNEE = { userId: INSTALLER, fullName: "Ivan Installer (Local)", email: "ivan@hivic-local.test" };
const events = (type?: string) => (T.workflow_events ?? []).filter((e) => !type || e.event_type === type);
const waitFor = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await new Promise((r) => setTimeout(r, 5)); } };
const storedAudit = () => (T.ceiling_measurements ?? []).find((m) => m.job_id === JOB && m.is_current)?.external_id ?? null;

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  clock.now = Date.now();
  Object.assign(T, {
    jobs: [{ id: JOB, job_number: "HV-9001", business_unit: "hivic", stage: "ready_check_scheduled", estimated_area_m2: 80, life_support: false, life_support_status: "no", property_id: "p1", owner_id: "o1", channel: "installer_sourced", source: "installer", originating_installer_business_id: BIZ }],
    properties: [{ id: "p1", address_line: "3 Fixture Road", suburb: "Stubbington", state: "VIC", postcode: "3997", occupancy: "owner_occupied", enrichment: {} }],
    owners: [{ id: "o1", full_name: "Harriet Homeowner (Local)", email: "homeowner@hivic-local.test", phone: "0400000002" }],
    job_assignments: [{ job_id: JOB, role: "installer", active: true, user_id: INSTALLER, business_id: BIZ, profiles: { full_name: "Ivan Installer (Local)", email: "ivan@hivic-local.test" } }], // embed as PostgREST returns it
    profiles: [{ id: INSTALLER, full_name: "Ivan Installer (Local)", email: "ivan@hivic-local.test" }],
    businesses: [{ id: BIZ, mitti_account_invited: true }],
    workflow_settings: [{ id: 1, mitti_ready_check_template_id: MITTI_TEMPLATE_ID, mitti_ready_check_priced_template_id: MITTI_TEMPLATE_ID, mitti_piesa_template_id: null, auto_send_mitti: true }],
    bookings: [{ id: "b1", job_id: JOB, kind: "ready_check", status: "confirmed", scheduled_start: "2026-10-12T00:00:00Z" }],
    ceiling_measurements: [], assessments: [], workflow_events: [],
  });
});

describe("1. a hanging Mitti request is aborted by the timeout", () => {
  test("realMittiCall aborts a call that never answers and reports it plainly (configured 20 s)", async () => {
    const saved = globalThis.fetch; const tokenSaved = process.env["MITTI_API_TOKEN"];
    process.env["MITTI_API_TOKEN"] = "local-test-token-not-real";
    let gotSignal = false;
    globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
      gotSignal = !!init?.signal;
      init?.signal?.addEventListener("abort", () => rej(new DOMException("The operation timed out.", "TimeoutError")));
    })) as typeof fetch; // never resolves on its own; no network
    const t0 = Date.now();
    try { await expect(realMittiCall("POST", "/audits", {})).rejects.toThrow("Mitti could not be reached"); }
    finally { globalThis.fetch = saved; if (tokenSaved === undefined) delete process.env["MITTI_API_TOKEN"]; else process.env["MITTI_API_TOKEN"] = tokenSaved; }
    const took = Date.now() - t0;
    expect(gotSignal).toBe(true);
    expect(took).toBeGreaterThanOrEqual(19_000);
    expect(took).toBeLessThan(26_000);
  }, 30_000);
});

describe("2. a slow Mitti never blocks the installer", () => {
  test("the start/try-again action returns at once (preparing) while Mitti is still busy; the form then opens", async () => {
    const m = fakeMitti({ create: "hang" });
    const t0 = Date.now();
    const state = await onsiteFormFor(JOB, INSTALLER, m.call, true);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(state.kind).toBe("preparing");
    await waitFor(() => m.calls.includes("POST /audits"));
    expect(storedAudit()).toBeNull(); // still waiting on Mitti
    m.release();
    await waitFor(() => storedAudit() !== null);
    expect((await onsiteFormFor(JOB, INSTALLER, m.call, false)).kind).toBe("open");
    expect(m.creates()).toBe(1);
  });
  test("start of the on-site flow schedules creation instead of awaiting it", () => {
    const src = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
    expect(src).toContain("const state = await onsiteFormFor(job.id, userId, call, true);");
    expect(src).not.toMatch(/await createAssignMittiAudit\(/);
    expect(src).toContain("scheduleReadyCheckFormCreation(");
  });
});

describe("3. a confirmed Ready Check booking starts exactly one creation", () => {
  test("booking twice (e.g. two triggers) -> one Mitti create", async () => {
    const m = fakeMitti();
    expect(await C.onReadyCheckBooked(JOB, INSTALLER, m.call)).toBe("scheduled");
    expect(await C.onReadyCheckBooked(JOB, INSTALLER, m.call)).toBe("scheduled");
    await waitFor(() => storedAudit() !== null);
    await new Promise((r) => setTimeout(r, 50));
    expect(m.creates()).toBe(1);
    expect(events(CLAIM_EVENT).length).toBe(1);
  });
  test("no creation when a switch is off (auto_send_mitti / not invited / no template / no booking)", async () => {
    const m = fakeMitti();
    T.workflow_settings![0]!.auto_send_mitti = false;
    expect(await C.onReadyCheckBooked(JOB, INSTALLER, m.call)).toBe("skipped");
    T.workflow_settings![0]!.auto_send_mitti = true; T.businesses![0]!.mitti_account_invited = false;
    expect(await C.onReadyCheckBooked(JOB, INSTALLER, m.call)).toBe("skipped");
    T.businesses![0]!.mitti_account_invited = true; T.bookings = [];
    expect(await C.onReadyCheckBooked(JOB, INSTALLER, m.call)).toBe("skipped");
    expect(m.calls).toEqual([]);
  });
  test("every Ready Check booking path calls onReadyCheckBooked right after its confirmBooking succeeds", () => {
    // Kept OUT of booking.server.ts on purpose: the autoAdvanceJob import graph must never reach Mitti (tests/comms.test.ts).
    expect(readFileSync("src/lib/booking.server.ts", "utf8")).not.toContain("mitti-create");
    const sites: [string, string][] = [
      ["src/lib/ready-check-times.server.ts", 'await confirmBooking(jobId, "ready_check", startsAt'], // Jo 24 Oct: owner/installer agree a time
      ["src/lib/installer-ready-check.server.ts", 'await confirmBooking(jobId, "ready_check", new Date(startIso)'],
      ["src/lib/installer-ready-check.server.ts", 'try { await confirmBooking(jobId, "ready_check", w.starts_at'],
      ["src/lib/onsite-ready-check.server.ts", 'await confirmBooking(job.id, "ready_check"'],
    ];
    for (const [file, call] of sites) {
      const src = readFileSync(file, "utf8"); const i = src.indexOf(call);
      expect(i).toBeGreaterThan(0);
      const after = src.slice(i, i + 700);
      // on-site "now" schedules through onsiteFormFor(request); every other path through onReadyCheckBooked
      expect(after.includes("onReadyCheckBooked(") || file.endsWith("onsite-ready-check.server.ts")).toBe(true);
    }
    expect(readFileSync("src/lib/onsite-ready-check.server.ts", "utf8")).toContain("if (later) await (await import(\"./mitti-create.server\")).onReadyCheckBooked(job.id, userId)");
  });
});

describe("4. two concurrent requests cannot create two forms", () => {
  test("exactly one wins the claim; the other is told it is already started", async () => {
    const m = fakeMitti();
    const rs = await Promise.allSettled([
      createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE }),
      createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE }),
      createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(rs.filter((r) => r.status === "rejected" && /Do not retry yet/.test(String((r as PromiseRejectedResult).reason?.message))).length).toBe(2);
    expect(m.creates()).toBe(1);
  });
  test("the claim id is deterministic per job + form kind + generation (the database primary key does the locking)", async () => {
    expect(await claimEventId(JOB, "ready_check", 0)).toBe(await claimEventId(JOB, "ready_check", 0));
    expect(await claimEventId(JOB, "ready_check", 0)).not.toBe(await claimEventId(JOB, "piesa", 0));
    expect(await claimEventId(JOB, "ready_check", 0)).not.toBe(await claimEventId(JOB, "ready_check", 1));
  });
});

describe("5. status polling never calls Mitti", () => {
  test("preparing, retry and office states: repeated polls make zero Mitti calls", async () => {
    const m = fakeMitti();
    for (let i = 0; i < 5; i++) expect((await onsiteFormFor(JOB, INSTALLER, m.call, false)).kind).toBe("preparing");
    T.workflow_events!.push({ id: "e-err", job_id: JOB, event_type: "mitti_access_needed", summary: "Mitti could not be reached. Try again shortly.", created_at: new Date(clock.now).toISOString() });
    for (let i = 0; i < 5; i++) expect((await onsiteFormFor(JOB, INSTALLER, m.call, false)).kind).toBe("retry");
    await new Promise((r) => setTimeout(r, 50));
    expect(m.calls).toEqual([]);
    expect(events(CLAIM_EVENT)).toEqual([]);
  });
});

describe("6. uncertain provider outcome is never blindly repeated", () => {
  test("create call timed out: claim kept, office flagged, later automatic attempts make no new create call", async () => {
    const m = fakeMitti({ create: "timeout" });
    await expect(createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE })).rejects.toThrow("may have created the form");
    expect(events(UNCERTAIN_EVENT).length).toBe(1);
    expect(events(RELEASE_EVENT)).toEqual([]);
    ageClaims(60 * 60_000); // an hour later: the old 10-minute expiry would have allowed a second create
    const again = fakeMitti();
    expect(await C.runReadyCheckFormCreation(JOB, INSTALLER, ASSIGNEE, again.call, { delaysMs: [] })).toBe("held");
    expect((await onsiteFormFor(JOB, INSTALLER, again.call, false)).kind).not.toBe("open");
    await new Promise((r) => setTimeout(r, 30));
    expect(again.creates()).toBe(0);
  });
  test("create returned no audit id: also uncertain, not retried", async () => {
    const m = fakeMitti({ create: "no_id" });
    await expect(createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE })).rejects.toThrow("may have created the form");
    expect(await C.runReadyCheckFormCreation(JOB, INSTALLER, ASSIGNEE, fakeMitti().call, { delaysMs: [] })).toBe("held");
  });
  test("only the office action can supersede an uncertain claim, and only after 10 minutes; it is recorded", async () => {
    await expect(createAssignMittiAudit(JOB, INSTALLER, fakeMitti({ create: "timeout" }).call, { readyCheck: true, assignee: ASSIGNEE })).rejects.toThrow();
    const office = fakeMitti();
    ageClaims(5 * 60_000);
    await expect(createAssignMittiAudit(JOB, "office-1", office.call, { readyCheck: true, assignee: ASSIGNEE, officeOverride: true })).rejects.toThrow("Do not retry yet");
    expect(office.creates()).toBe(0);
    ageClaims(6 * 60_000);
    const r = await createAssignMittiAudit(JOB, "office-1", office.call, { readyCheck: true, assignee: ASSIGNEE, officeOverride: true });
    expect(r.reused).toBe(false);
    expect(office.creates()).toBe(1);
    expect(events(OFFICE_OVERRIDE_EVENT).length).toBe(1);
    expect(String(events(OFFICE_OVERRIDE_EVENT)[0]!.summary)).toContain("Check Mitti for a duplicate");
  });
  test("failure BEFORE the create call (certain nothing was created) releases the claim so a retry may proceed", async () => {
    await expect(createAssignMittiAudit(JOB, INSTALLER, fakeMitti({ search: "timeout" }).call, { readyCheck: true, assignee: ASSIGNEE })).rejects.toThrow("could not be reached");
    expect(events(RELEASE_EVENT).length).toBe(1);
    const ok = fakeMitti();
    expect((await createAssignMittiAudit(JOB, INSTALLER, ok.call, { readyCheck: true, assignee: ASSIGNEE })).reused).toBe(false);
    expect(ok.creates()).toBe(1);
  });
  test("background run retries only certain-not-created network failures, bounded", async () => {
    const m = fakeMitti({ search: "timeout" });
    expect(await C.runReadyCheckFormCreation(JOB, INSTALLER, ASSIGNEE, m.call, { delaysMs: [0, 0] })).toBe("failed");
    expect(m.calls.filter((c) => c === "POST /users/search").length).toBe(3);
    expect(m.creates()).toBe(0);
  });
});

describe("7. a stored audit is reused (never re-created)", () => {
  test("existing Ready Check audit: re-shared, no create call, no claim", async () => {
    T.ceiling_measurements = [{ id: "cm1", job_id: JOB, is_current: true, status: "draft", external_source: "mitti", external_id: "audit_existing" }];
    const m = fakeMitti();
    const r = await createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE });
    expect(r).toMatchObject({ auditId: "audit_existing", reused: true });
    expect(m.calls).toEqual(["POST /users/search", "GET /audits/audit_existing", "POST /audits/audit_existing/share", "PUT /inspections/v1/inspections/audit_existing/owner"]);
    expect(m.creates()).toBe(0);
    expect(events(CLAIM_EVENT)).toEqual([]);
  });
  test("form created but share failed: the new audit id is stored, so the retry re-shares instead of creating again", async () => {
    await expect(createAssignMittiAudit(JOB, INSTALLER, fakeMitti({ share: "fail" }).call, { readyCheck: true, assignee: ASSIGNEE })).rejects.toThrow();
    expect(storedAudit()).toBe("audit_1");
    const retry = fakeMitti();
    expect((await createAssignMittiAudit(JOB, INSTALLER, retry.call, { readyCheck: true, assignee: ASSIGNEE })).reused).toBe(true);
    expect(retry.calls).toContain("GET /audits/audit_1");
    expect(retry.creates()).toBe(0);
  });
});

describe("8. existing behaviour kept", () => {
  test("happy path: one create, audit stored, created event logged, poll then opens the form", async () => {
    const m = fakeMitti();
    const r = await createAssignMittiAudit(JOB, INSTALLER, m.call, { readyCheck: true, assignee: ASSIGNEE });
    expect(r).toMatchObject({ auditId: "audit_1", reused: false });
    expect(m.calls).toEqual(["POST /users/search", `GET /templates/v1/templates/${MITTI_TEMPLATE_ID}`, "POST /audits", "POST /audits/audit_1/share", "PUT /inspections/v1/inspections/audit_1/owner"]);
    expect(events("mitti_audit_created").length).toBe(1);
    expect((await onsiteFormFor(JOB, INSTALLER, m.call, false)).kind).toBe("open");
  });
  test("switch states still win before anything else (auto_send off -> office; not invited -> office)", async () => {
    T.workflow_settings![0]!.auto_send_mitti = false;
    expect((await onsiteFormFor(JOB, INSTALLER, fakeMitti().call, true)).kind).toBe("office");
  });
  test("the office button passes officeOverride; the installer field-day button is an explicit request", () => {
    expect(readFileSync("src/lib/portal.functions.ts", "utf8")).toContain("createAssignMittiAudit(data.jobId, context.userId, realMittiCall, { officeOverride: true })");
    expect(readFileSync("src/routes/_authenticated/field.day.$jobId.tsx", "utf8")).toContain("get({ data: { jobId, retry: true } })");
  });
});
