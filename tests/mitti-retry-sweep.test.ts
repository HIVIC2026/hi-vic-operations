// Task 4 (Mitti form retry): the retry sweep. Real sweep, real creators (Ready Check, PIESA, electrical fixes,
// install day), real claim guard and real alert sender; fake Mitti (no network), fake gateway, in-memory admin DB
// enforcing the workflow_events primary key like Postgres. Time is passed in. Fictional data only.
import { beforeEach, describe, expect, mock, test } from "bun:test";

// ---------- in-memory admin client (PK-enforcing for workflow_events) ----------
type Row = Record<string, unknown>;
const T: Record<string, Row[]> = {};
const clock = { now: 0 };
let seq = 0;
function from(table: string) {
  let op: "select" | "insert" | "update" | "delete" = "select"; let values: unknown = null; let head = false; let wantCount = false;
  let page: [number, number] | null = null;
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
    if (op === "delete") { T[table] = rows().filter((r) => !match(r)); return { data: null, error: null }; }
    let hit = rows().filter(match);
    if (page) hit = hit.slice(page[0], page[1] + 1);
    return { data: head ? null : hit, error: null, count: wantCount ? hit.length : null };
  };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { head = !!o?.head; wantCount = !!o?.count; return q; },
    eq: (k: string, v: unknown) => { f.push([k, "eq", v]); return q; }, in: (k: string, v: unknown[]) => { f.push([k, "in", v]); return q; },
    is: (k: string, v: unknown) => { f.push([k, "is", v]); return q; },
    neq: () => q, not: () => q, gte: () => q, gt: () => q, lt: () => q, lte: () => q, contains: () => q, order: () => q, limit: () => q,
    range: (a: number, b: number) => { page = [a, b]; return q; },
    insert: (v: unknown) => { op = "insert"; values = v; return q; }, update: (v: unknown) => { op = "update"; values = v; return q; }, delete: () => { op = "delete"; return q; },
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
let scopeName = "MEASURE_UP_ONLY";
mock.module("../src/lib/requirements.server", () => ({
  jobScope: async (jobId: string) => ({ scope: scopeName, label: "Ready Check", measurementRow: (T.ceiling_measurements ?? []).find((m) => m.job_id === jobId && m.is_current) ?? null }),
}));
const realOfficialCore = await import("../src/lib/official-forms.core");
mock.module("../src/lib/official-forms.core", () => ({ ...realOfficialCore, officialFormUseBlocker: () => null }));
mock.module("../src/lib/official-forms.server", () => ({ officialPrefillContext: async () => ({ address: "3 Fixture Road, Stubbington VIC 3997", electrician: null, piesaAnswers: null }) }));
mock.module("../src/lib/official-prefill.core", () => ({ piisaPrefill: () => [] }));
mock.module("../src/lib/piisa-ap.core", () => ({ ensurePiisaAp: async () => undefined }));
mock.module("../src/lib/prestart.server", () => ({ requirePrestartClear: async () => undefined, prestartGate: async () => ({ locked: false, reasons: [] }) }));

// The Ready Check link step is tested elsewhere; here it is a recorder that does what matters (points the job at the form).
const linkCalls: { auditId: string; jobId: string }[] = [];
mock.module("../src/lib/mitti-pickup.server", () => ({
  linkMittiReadyCheckToJob: async (_actor: unknown, input: { auditId: string; jobId: string }) => {
    linkCalls.push(input);
    (T.ceiling_measurements ??= []).push({ job_id: input.jobId, is_current: true, external_source: "mitti", external_id: input.auditId, status: "draft" });
    (T.workflow_events ??= []).push({ id: `ev-link-${++seq}`, job_id: input.jobId, event_type: "mitti_audit_linked", created_at: new Date(clock.now).toISOString(), details: { audit_id: input.auditId } });
    return { linked: true };
  },
}));

// TEST people are routed to the persistent simulator; here it is a recorder so the routing can be seen.
const simHolder: { call: ((m: string, p: string, b?: unknown) => Promise<unknown>) | null; calls: string[] } = { call: null, calls: [] };
const realSim = await import("../src/lib/mitti-sim-store.server");
mock.module("../src/lib/mitti-sim-store.server", () => ({
  ...realSim,
  persistentSimMittiCall: async (m: string, p: string, b?: unknown) => { simHolder.calls.push(`${m} ${p}`); return simHolder.call!(m, p, b); },
}));

// Office alert plumbing (same fakes as office-alert-email.test.ts).
let commsOn = true; let commsThrows = false;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => { if (commsThrows) throw new Error("comms switch unreadable"); return commsOn; } }));
const testSends: { to: string; subject: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_ctx: unknown, to: string, subject: string) => { testSends.push({ to, subject }); return { channel: "email", to, status: "sent", detail: "x" }; },
}));
const gateway: { to: string[]; subject: string; text: string }[] = [];
const outbound: string[] = [];
globalThis.fetch = (async (url: string, init: { body: string }) => {
  outbound.push(String(url));
  if (!String(url).includes("connector-gateway")) throw new Error("unexpected network call " + url);
  gateway.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "msg_1" }), { status: 200 });
}) as never;
process.env["RESEND_API_KEY"] = "k"; process.env["LOVABLE_API_KEY"] = "g";

const { MITTI_TEMPLATE_ID } = await import("../src/lib/mitti.core");
const M = await import("../src/lib/mitti.server");
const { runReadyCheckFormCreation, MittiOutcomeUncertain } = await import("../src/lib/mitti-create.server");
const { createFixesForm } = await import("../src/lib/fixes-day.server");
const { FIXES_DAY_QUESTIONS, FIXES_FORM_CREATED_EVENT } = await import("../src/lib/fixes-day.core");
const { simulatedInstallDayTemplate } = await import("../src/lib/journey-sim.core");
const { runMittiRetrySweep } = await import("../src/lib/mitti-retry.server");
const R = await import("../src/lib/mitti-retry.core");
const { CLAIM_EVENT, RELEASE_EVENT, UNCERTAIN_EVENT } = await import("../src/lib/mitti-create-claim.core");
const { PIISA_AUDIT_CREATED_EVENT } = await import("../src/lib/piisa-autosend.core");
const { TEST_MITTI_ASSIGNEE } = await import("../src/lib/onsite-ready-check.core");
const { TEST_ALLOWLIST } = await import("../src/lib/test-send.core");

// ---------- fake Mitti ----------
const A2_UUID = "dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39";
const A2_TEMPLATE_ID = "template_dbaf67a2c9c541208c690f4a43c5bd39";
const FIXES = simulatedInstallDayTemplate(FIXES_DAY_QUESTIONS);
const RC_TEMPLATE = {
  template_id: MITTI_TEMPLATE_ID,
  header_items: [
    { item_id: "h1", label: "Portal Job Number", type: "text" }, { item_id: "h2", label: "Site address", type: "address" },
    { item_id: "h3", label: "Owner name", type: "text" }, { item_id: "h4", label: "Owner email", type: "text" },
    { item_id: "h5", label: "Assigned Electrician / Assessor", type: "text" }, { item_id: "h6", label: "Assessment date/time", type: "datetime" },
  ],
  items: [{ item_id: "s1", label: "Office details", type: "section" }, { item_id: "i1", parent_id: "s1", label: "Office estimated ceiling area (m²)", type: "text" }],
};
const INSTALL_TEMPLATE = { template: { template_id: A2_TEMPLATE_ID, name: "TEST install day", items: [{ item_id: "job", label: "Portal Job Number", type: "textsingle" }, { item_id: "address", label: "Site address", type: "address" }] } };

type Kind = "ready_check" | "piesa" | "fixes" | "install_day";
type Found = { id: string; owner?: string; jobNumber?: string | null; address?: string; name?: string };
type Behaviour = { kind?: Kind; create?: "ok" | "timeout"; search?: "ok" | "error"; noUser?: boolean; found?: Found[] };
const CLAIM_TEMPLATE: Record<Kind, string> = { ready_check: MITTI_TEMPLATE_ID, piesa: MITTI_TEMPLATE_ID, fixes: A2_UUID, install_day: A2_UUID };
function fakeMitti(b: Behaviour = {}) {
  const kind = b.kind ?? "ready_check";
  const calls: string[] = []; let n = 0;
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (path === "/users/search") {
      if (b.noUser) return { users: [] };
      const email = ((body as { email?: string[] } | undefined)?.email ?? [])[0] ?? "";
      return { users: [{ id: "user_9", email }] };
    }
    if (path.startsWith("/templates/")) return kind === "fixes" ? { template: { template_id: A2_TEMPLATE_ID, name: "Fixes", items: FIXES.items, response_sets: FIXES.response_sets } } : kind === "install_day" ? INSTALL_TEMPLATE : RC_TEMPLATE;
    if (method === "GET" && path.startsWith("/audits/search")) {
      if (b.search === "error") throw new Error("Mitti request failed (500).");
      return { audits: (b.found ?? []).map((f) => ({ audit_id: f.id, template_id: CLAIM_TEMPLATE[kind] })) };
    }
    if (method === "GET" && path.startsWith("/audits/")) {
      const id = decodeURIComponent(path.slice("/audits/".length));
      const f = (b.found ?? []).find((x) => x.id === id);
      if (f) return {
        audit_id: id, template_id: CLAIM_TEMPLATE[kind], audit_data: { authorship: { owner_id: f.owner ?? "user_9" } },
        header_items: [
          ...(f.jobNumber === null ? [] : [{ item_id: "h1", label: "Portal Job Number", type: "text", responses: { text: f.jobNumber ?? "HV-9001" } }]),
          { item_id: "h2", label: "Site address", type: "address", responses: { text: f.address ?? "3 Fixture Road, Stubbington VIC 3997" } },
          { item_id: "h3", label: "Homeowner name", type: "text", responses: { text: f.name ?? "Harriet Homeowner (Local)" } },
        ], items: [],
      };
      return { audit_id: id, template_id: CLAIM_TEMPLATE[kind], header_items: [{ item_id: "h1", label: "Portal Job Number", responses: { text: "HV-9001" } }], items: [] };
    }
    if (path === "/audits") {
      if (b.create === "timeout") throw new Error("Mitti could not be reached. Try again shortly.");
      return { audit_id: `audit_${++n}` };
    }
    if (path.endsWith("/share") || path.endsWith("/owner")) return {};
    throw new Error("unexpected " + path);
  };
  return { call: call as never, calls, creates: () => calls.filter((c) => c === "POST /audits").length, searches: () => calls.filter((c) => c === "GET /audits/search").length };
}

const JOB = "a0000000-0000-4000-8000-0000000000f1";
const BIZ = "a0000000-0000-4000-8000-000000000011";
const TRADE = "a0000000-0000-4000-8000-000000000003";
const TRADE_EMAIL = "ivan@hivic-local.test";
const ASSIGNEE = { userId: TRADE, fullName: "Ivan Installer (Local)", email: TRADE_EMAIL };
const events = (type?: string) => (T.workflow_events ?? []).filter((e) => !type || e.event_type === type);
const T0 = Date.parse("2026-11-02T03:00:00Z");
const at = (minutes: number) => { clock.now = T0 + minutes * 60_000; return new Date(clock.now); };
const profile = { full_name: "Ivan Installer (Local)", email: TRADE_EMAIL };

/** Per-kind job set-up, and the call that makes the form first time round. */
function setup(kind: Kind, o: { source?: string } = {}) {
  for (const k of Object.keys(T)) delete T[k];
  scopeName = kind === "piesa" ? "FULL" : "MEASURE_UP_ONLY";
  const stage = { ready_check: "ready_check_scheduled", piesa: "piesa_scheduled", fixes: "piesa_complete", install_day: "installation_booked" }[kind];
  const role = kind === "piesa" || kind === "fixes" ? "electrician" : "installer";
  Object.assign(T, {
    jobs: [{ id: JOB, job_number: "HV-9001", business_unit: "hivic", stage, estimated_area_m2: 80, life_support: false, life_support_status: "no", property_id: "p1", owner_id: "o1", channel: kind === "ready_check" ? "installer_sourced" : "web", source: o.source ?? "installer", originating_installer_business_id: BIZ }],
    properties: [{ id: "p1", address_line: "3 Fixture Road", suburb: "Stubbington", state: "VIC", postcode: "3997", occupancy: "owner_occupied", enrichment: {} }],
    owners: [{ id: "o1", full_name: "Harriet Homeowner (Local)", email: "homeowner@hivic-local.test", phone: "0400000002" }],
    job_assignments: [{ job_id: JOB, role, active: true, user_id: TRADE, business_id: BIZ, profiles: profile, businesses: { name: "Ivan Sparks P/L", onboarding_notes: null } }],
    profiles: [{ id: TRADE, ...profile }],
    businesses: [{ id: BIZ, mitti_account_invited: true }],
    workflow_settings: [{ id: 1, mitti_ready_check_template_id: MITTI_TEMPLATE_ID, mitti_ready_check_priced_template_id: MITTI_TEMPLATE_ID, mitti_piesa_template_id: MITTI_TEMPLATE_ID, mitti_piisa_template_id: A2_UUID, mitti_fixes_template_id: A2_UUID, auto_send_mitti: true }],
    bookings: [
      { id: "b1", job_id: JOB, kind: "ready_check", status: "confirmed", scheduled_start: "2026-11-05T00:00:00Z" },
      { id: "b2", job_id: JOB, kind: "assessment", status: "confirmed", scheduled_start: "2026-11-06T00:00:00Z" },
      { id: "b3", job_id: JOB, kind: "rectification", status: "confirmed", scheduled_start: "2026-11-07T00:00:00Z" },
      { id: "b4", job_id: JOB, kind: "installation", status: "confirmed", scheduled_start: "2026-11-08T00:00:00Z" },
    ],
    rectification_items: [{ job_id: JOB, status: "required", description: "Replace RCD" }],
    ceiling_measurements: [], assessments: [],
    workflow_events: [{ id: "e-rc", job_id: JOB, event_type: "stage_changed", to_stage: "ready_check_complete" }],
  });
}
const makeForm = (kind: Kind, m: { call: never }) => ({
  ready_check: () => runReadyCheckFormCreation(JOB, null, ASSIGNEE, m.call, { delaysMs: [] }),
  piesa: () => M.createAssignMittiAudit(JOB, null, m.call),
  fixes: () => createFixesForm(JOB, null, "b3", m.call),
  install_day: () => M.createPiisaMittiAudit(JOB, null, m.call),
})[kind]().catch((e) => e);
/** A first attempt whose reply is lost: the claim is kept and the job is flagged uncertain at T0. */
async function failUncertain(kind: Kind) {
  clock.now = T0;
  const m = fakeMitti({ kind, create: "timeout" });
  const r = await makeForm(kind, m);
  if (kind === "ready_check") expect(r).toBe("uncertain"); else if (kind !== "fixes") expect(r).toBeInstanceOf(MittiOutcomeUncertain);
  expect(events(UNCERTAIN_EVENT).length).toBe(1);
  expect(m.creates()).toBe(1);
}
const overrides = () => events("mitti_access_override").filter((e) => e.summary === "Retry made the form automatically");
const sweepWith = (m: { call: never }, minutes: number) => runMittiRetrySweep({ now: at(minutes), callFor: () => m.call });

beforeEach(() => {
  setup("ready_check");
  clock.now = T0; commsOn = true; commsThrows = false;
  gateway.length = 0; testSends.length = 0; outbound.length = 0; linkCalls.length = 0; simHolder.calls.length = 0; simHolder.call = null;
});

describe("the retry sweep", () => {
  test("1. fail then retry works: one form, flag cleared, no email", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti();
    const early = await sweepWith(m, 1);
    expect(early).toEqual({ checked: 1, linked: 0, retried: 0, alerted: 0 }); // still inside the 2 minute wait
    expect(m.calls).toEqual([]);
    const r = await sweepWith(m, 3);
    expect(r).toEqual({ checked: 1, linked: 0, retried: 1, alerted: 0 });
    expect(m.searches()).toBe(1);
    expect(m.creates()).toBe(1);
    expect(events(R.RETRY_STARTED_EVENT).length).toBe(1);
    expect(events(RELEASE_EVENT).length).toBe(1);
    expect(overrides().length).toBe(1);
    expect(gateway.length + testSends.length).toBe(0);
    expect(events(R.ALERT_SENT_EVENT).length).toBe(0);
    // resolved: nothing left to do
    const again = await sweepWith(m, 6);
    expect(again.checked).toBe(0);
    expect(m.creates()).toBe(1);
  });

  test("2. lost reply: the form Mitti made is found and linked, nothing new is made", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti({ found: [{ id: "audit_lost" }] });
    const r = await sweepWith(m, 3);
    expect(r).toMatchObject({ checked: 1, linked: 1, retried: 0, alerted: 0 });
    expect(m.creates()).toBe(0);
    expect(linkCalls).toEqual([{ auditId: "audit_lost", jobId: JOB }]);
    expect(events(R.RETRY_LINKED_EVENT).map((e) => e.details)).toEqual([{ kind: "ready_check", audit_id: "audit_lost" }]);
    expect(events(R.RETRY_STARTED_EVENT).length).toBe(0);
    expect(gateway.length).toBe(0);
    expect((await sweepWith(m, 6)).checked).toBe(0);
  });

  test("3. both retries fail: exactly one email (even with two sweeps at once), flag still open", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti({ create: "timeout" });
    expect(await sweepWith(m, 3)).toMatchObject({ retried: 1, alerted: 0 });
    expect(events(UNCERTAIN_EVENT).length).toBe(2); // the failed retry is the new failure
    expect(await sweepWith(m, 4)).toMatchObject({ retried: 0, alerted: 0 }); // waits 2 minutes from the last attempt
    expect(await sweepWith(m, 6)).toMatchObject({ retried: 1, alerted: 0 });
    expect(m.creates()).toBe(2);
    expect(gateway.length).toBe(0);
    const [a, b] = await Promise.all([sweepWith(m, 9), sweepWith(m, 9)]);
    expect(a.alerted + b.alerted).toBe(1);
    expect(m.creates()).toBe(2); // never a third try
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.to).toEqual(["info@homeinsulationvictoria.com.au"]);
    expect(gateway[0]!.subject).toContain("HV-9001");
    expect(gateway[0]!.text).toContain("Ivan Installer (Local)");
    expect(gateway[0]!.text).toContain("/admin/jobs/" + JOB);
    expect(events(R.ALERT_SENT_EVENT).length).toBe(1);
    expect(overrides().length).toBe(0); // the office flag stays open
    expect(events(UNCERTAIN_EVENT).length).toBe(3); // the first failure plus one per retry, no extra
    await sweepWith(m, 12);
    expect(gateway.length).toBe(1);
  });

  test("4. trade not found: no retry, email at once", async () => {
    clock.now = T0;
    const bad = fakeMitti({ noUser: true });
    expect(await runReadyCheckFormCreation(JOB, null, ASSIGNEE, bad.call, { delaysMs: [] })).toBe("failed");
    expect(events("mitti_access_needed").length).toBe(1);
    const m = fakeMitti();
    const r = await sweepWith(m, 0);
    expect(r).toMatchObject({ checked: 1, retried: 0, alerted: 1 });
    expect(m.calls).toEqual([]);
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.text).toContain("was not found in Mitti");
    expect(events(R.RETRY_STARTED_EVENT).length).toBe(0);
  });

  test("5. two sweeps at once make one form and no email", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti();
    const [a, b] = await Promise.all([sweepWith(m, 3), sweepWith(m, 3)]);
    expect(m.creates()).toBe(1);
    expect(a.retried + b.retried).toBe(1);
    expect(events(R.RETRY_STARTED_EVENT).length).toBe(1);
    expect(gateway.length).toBe(0);
    expect(overrides().length).toBe(1);
  });

  test("7. a search error emails and creates nothing", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti({ search: "error" });
    const r = await sweepWith(m, 3);
    expect(r).toMatchObject({ retried: 0, alerted: 1 });
    expect(m.creates()).toBe(0);
    expect(events(RELEASE_EVENT).length).toBe(0);
    expect(gateway.length).toBe(1);
    expect(gateway[0]!.text).toContain("Could not check Mitti");
  });

  test("7b. more than one match, or a form that is not with the trade, emails and creates nothing", async () => {
    await failUncertain("ready_check");
    const many = fakeMitti({ found: [{ id: "a1" }, { id: "a2" }] });
    expect(await sweepWith(many, 3)).toMatchObject({ retried: 0, linked: 0, alerted: 1 });
    expect(many.creates()).toBe(0);
    expect(linkCalls.length).toBe(0);

    setup("ready_check"); gateway.length = 0; await failUncertain("ready_check");
    const elsewhere = fakeMitti({ found: [{ id: "a3", owner: "someone_else" }] });
    expect(await sweepWith(elsewhere, 3)).toMatchObject({ retried: 0, linked: 0, alerted: 1 });
    expect(elsewhere.creates()).toBe(0);
  });

  test("7c. a form for another job or another person does not block the retry", async () => {
    await failUncertain("ready_check");
    const m = fakeMitti({ found: [{ id: "x1", jobNumber: "HV-1234" }, { id: "x2", owner: "someone_else", jobNumber: "HV-1234" }] });
    expect(await sweepWith(m, 3)).toMatchObject({ retried: 1, linked: 0, alerted: 0 });
    expect(m.creates()).toBe(1);
  });

  test("8. skips when the office already fixed it", async () => {
    await failUncertain("ready_check");
    clock.now = T0 + 60_000;
    (T.workflow_events as Row[]).push({ id: "e-office", job_id: JOB, event_type: "mitti_audit_linked", created_at: new Date(clock.now).toISOString(), details: { audit_id: "by_hand" } });
    const m = fakeMitti();
    const r = await sweepWith(m, 3);
    expect(r).toEqual({ checked: 0, linked: 0, retried: 0, alerted: 0 });
    expect(m.calls).toEqual([]);
    expect(gateway.length).toBe(0);
  });

  test("failures before go-live are left alone", async () => {
    clock.now = Date.parse("2026-10-20T00:00:00Z");
    const m0 = fakeMitti({ create: "timeout" });
    await makeForm("ready_check", m0);
    const m = fakeMitti();
    expect(await runMittiRetrySweep({ now: new Date("2026-10-28T00:00:00Z"), callFor: () => m.call })).toMatchObject({ checked: 0 });
    expect(m.calls).toEqual([]);
  });

  test("one bad case never stops the others", async () => {
    await failUncertain("ready_check");
    // A second job that cannot be checked (no claim row) and whose alert cannot be sent: the sweep logs it and carries on.
    const JOB2 = "a0000000-0000-4000-8000-0000000000f9";
    (T.jobs as Row[]).push({ id: JOB2, job_number: "HV-9002", source: "installer" });
    (T.workflow_events as Row[]).push({ id: "e-bad", job_id: JOB2, event_type: UNCERTAIN_EVENT, created_at: new Date(T0).toISOString(), summary: "x", details: { kind: "piesa", claim_id: "missing", detail: "boom" } });
    commsThrows = true;
    const m = fakeMitti();
    const r = await sweepWith(m, 3);
    expect(r.checked).toBe(2);
    expect(r.retried).toBe(1); // the first job was retried regardless
    const errs = events("mitti_retry_error");
    expect(errs.length).toBe(1);
    expect(errs[0]!.job_id).toBe(JOB2);
    expect(String(errs[0]!.summary)).toContain("comms switch unreadable");
  });

  test("9. a test job uses the simulator and the allowlist", async () => {
    setup("ready_check", { source: "qa_test" });
    clock.now = T0;
    const first = fakeMitti({ create: "timeout" });
    const testAssignee = { ...ASSIGNEE, email: TEST_MITTI_ASSIGNEE };
    expect(await runReadyCheckFormCreation(JOB, null, testAssignee, first.call, { delaysMs: [] })).toBe("uncertain");
    expect((events(CLAIM_EVENT)[0]!.details as { assignee_email: string }).assignee_email).toBe(TEST_MITTI_ASSIGNEE);
    const sim = fakeMitti();
    simHolder.call = sim.call as never;
    // no callFor: the real caller is used, and a TEST person goes to the simulator, never the network
    const r = await runMittiRetrySweep({ now: at(3) });
    expect(r).toMatchObject({ retried: 1, alerted: 0 });
    expect(simHolder.calls.length).toBeGreaterThan(0);
    expect(simHolder.calls.some((c) => c.startsWith("GET /audits/search"))).toBe(true);
    expect(sim.creates()).toBe(1);
    expect(outbound).toEqual([]);
    // an alert for a test job goes only to the test allowlist
    setup("ready_check", { source: "qa_test" });
    clock.now = T0;
    expect(await runReadyCheckFormCreation(JOB, null, testAssignee, fakeMitti({ noUser: true }).call, { delaysMs: [] })).toBe("failed");
    expect(await runMittiRetrySweep({ now: at(0) })).toMatchObject({ alerted: 1 });
    expect(gateway.length).toBe(0);
    expect(testSends.length).toBe(1);
    expect(TEST_ALLOWLIST.email).toContain(testSends[0]!.to);
  });
});

describe("6. every kind of form passes the fail-then-retry case, and the lost-reply case", () => {
  for (const kind of ["ready_check", "piesa", "fixes", "install_day"] as const) {
    test(`${kind}: retry makes one form, clears the flag, sends no email`, async () => {
      setup(kind);
      await failUncertain(kind);
      const claim = events(CLAIM_EVENT)[0]!.details as { kind: string; assignee_email: string; template_id: string };
      expect(claim).toMatchObject({ kind, assignee_email: TRADE_EMAIL });
      const m = fakeMitti({ kind });
      const r = await sweepWith(m, 3);
      expect(r).toMatchObject({ checked: 1, retried: 1, alerted: 0 });
      expect(m.creates()).toBe(1);
      expect(overrides().length).toBe(1);
      expect((overrides()[0]!.details as { kind: string }).kind).toBe(kind);
      expect(gateway.length).toBe(0);
      expect((await sweepWith(m, 6)).checked).toBe(0);
    });
    test(`${kind}: a form Mitti already made is adopted, not duplicated`, async () => {
      setup(kind);
      await failUncertain(kind);
      const m = fakeMitti({ kind, found: [{ id: "audit_lost" }] });
      const r = await sweepWith(m, 3);
      expect(r).toMatchObject({ checked: 1, linked: 1, retried: 0, alerted: 0 });
      expect(m.creates()).toBe(0);
      expect(events(R.RETRY_LINKED_EVENT).map((e) => e.details)).toEqual([{ kind, audit_id: "audit_lost" }]);
      if (kind === "piesa") expect((T.assessments as Row[])[0]!.external_mitti_id).toBe("audit_lost");
      if (kind === "fixes") expect(events(FIXES_FORM_CREATED_EVENT)[0]!.details).toMatchObject({ audit_id: "audit_lost", booking_id: "b3" });
      if (kind === "install_day") expect(events(PIISA_AUDIT_CREATED_EVENT).some((e) => (e.details as { audit_id?: string }).audit_id === "audit_lost")).toBe(true);
      if (kind === "ready_check") expect(linkCalls.length).toBe(1);
      expect((await sweepWith(m, 6)).checked).toBe(0);
    });
  }
});
