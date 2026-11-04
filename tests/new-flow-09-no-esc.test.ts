// Part 9 Task 14 (Jo 2 Nov 2026, answers 18–19): a per-job "no ESC" marker for real runs — the ESC notice robot, every
// Registry submission/update recorder and VEEC creation refuse marked jobs; the GO check and PIISA timing skip only the
// ESC-notice lines; unmarked jobs behave exactly as before; the marker is one-way and fails closed on a read error.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NO_ESC_BADGE, NO_ESC_MARKER_SET_EVENT, NO_ESC_NOTICE_ALREADY_SENT, NO_ESC_PRESTART_NOTE, NO_ESC_REF, NO_ESC_REFUSAL, noEscMarked, withNoEscMarker } from "../src/lib/no-esc.core";
import { jobMode, planVeecCreation, type VeecCandidate } from "../src/lib/esc-registry-robot.core";
import { COPAYMENT_TOO_LOW, veecCreationBlockers } from "../src/lib/veec-creation-gate.core";
import { prestartFailures, prestartNotes, type PrestartFacts } from "../src/lib/prestart.core";
import { piisaTimingBlockers } from "../src/lib/esc.core";

// ---------- pure ----------
describe("noEscMarked / withNoEscMarker", () => {
  test("only external_refs.no_esc === true counts", () => {
    expect(NO_ESC_REF).toBe("no_esc");
    expect(noEscMarked({ no_esc: true })).toBe(true);
    expect(noEscMarked({ no_esc: "true" })).toBe(false);
    expect(noEscMarked({ qa_no_delivery: true })).toBe(false);
    expect(noEscMarked(null)).toBe(false);
    expect(noEscMarked(undefined)).toBe(false);
  });
  test("the patch keeps every other key", () => {
    expect(withNoEscMarker({ owner_agreed_price: true, reference: "X" })).toEqual({ owner_agreed_price: true, reference: "X", no_esc: true });
    expect(withNoEscMarker(null)).toEqual({ no_esc: true });
  });
  test("wording pins", () => {
    expect(NO_ESC_REFUSAL).toBe("Real-run job marked “no ESC”: nothing goes to the ESC Registry and no certificates are created.");
    expect(NO_ESC_NOTICE_ALREADY_SENT).toBe("An ESC notice was already sent for this job — withdraw it first.");
    expect(NO_ESC_PRESTART_NOTE).toBe("No ESC (real-run job): ESC notice skipped");
    expect(NO_ESC_BADGE).toBe("Real run — no ESC");
    expect(NO_ESC_MARKER_SET_EVENT).toBe("no_esc_marker_set");
  });
});

describe("robot jobMode", () => {
  test("marked → off, whatever the mode or source", () => {
    expect(jobMode("live", "website", true)).toBe("off");
    expect(jobMode("dry_run", "qa_test", true)).toBe("off");
  });
  test("unmarked → unchanged (live stays live, TEST downgrades to dry run, off stays off)", () => {
    expect(jobMode("live", "website")).toBe("live");
    expect(jobMode("live", "website", false)).toBe("live");
    expect(jobMode("live", "qa_test", false)).toBe("dry_run");
    expect(jobMode("off", "website", false)).toBe("off");
  });
});

describe("veecCreationBlockers / planVeecCreation", () => {
  const veec = (o: Partial<VeecCandidate> = {}): VeecCandidate => ({
    jobId: "job-1", jobSource: "website", stage: "ready_for_veec", lodgement: { status: "not_submitted", submission_reference: null },
    assignment: { status: "effective_complete", installerSignedAt: "a", apSignedAt: "b", consumerSignedAt: "c" }, quantity: 12, robotEvents: [],
    productProblems: [], installPaidCents: 20000, ...o,
  });
  test("marked → the refusal comes first, with the other blockers after it", () => {
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 20000, noEsc: true })).toEqual([NO_ESC_REFUSAL]);
    expect(veecCreationBlockers({ productProblems: ["Product: x"], installPaidCents: 0, noEsc: true })).toEqual([NO_ESC_REFUSAL, "Product: x", COPAYMENT_TOO_LOW]);
  });
  test("unmarked (false or not given) → byte-identical to Task 11", () => {
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 20000, noEsc: false })).toEqual([]);
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 20000 })).toEqual([]);
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 19999 })).toEqual([COPAYMENT_TOO_LOW]);
  });
  test("planVeecCreation: a marked candidate is skipped for the office with the refusal", () => {
    expect(planVeecCreation(veec({ noEsc: true }))).toMatchObject({ action: "skip", office: true, reason: NO_ESC_REFUSAL });
    expect(planVeecCreation(veec()).action).toBe("submit");
  });
});

describe("GO check on a marked job", () => {
  const start = "2026-11-11T21:00:00Z";
  const facts = (o: Partial<PrestartFacts> = {}): PrestartFacts => ({
    start, clearance: { cleared: true, blocker: null }, deadline: "2026-11-20", esc: null,
    lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Sam" },
    consentBlockers: [], piesaCompletedAt: "2026-11-01", ...o,
  });
  test("unmarked with no notice → the ESC failure, as before", () => {
    expect(prestartFailures(facts())).toEqual(["ESC notification is not marked submitted for this install date."]);
    expect(prestartNotes(facts())).toEqual([]);
  });
  test("marked with no notice → no ESC line, the note instead; a late notice is not a failure either", () => {
    expect(prestartFailures(facts({ noEsc: true }))).toEqual([]);
    expect(prestartNotes(facts({ noEsc: true }))).toEqual([NO_ESC_PRESTART_NOTE]);
    const late = { id: "n1", status: "sent", sent_at: "2026-11-11T20:00:00Z", submission_reference: "R", scheduled_start: start } as unknown as PrestartFacts["esc"];
    expect(prestartFailures(facts({ noEsc: true, esc: late }))).toEqual([]);
  });
  test("marked still blocks a missing SWMS signature and a missing certificate / Part C", () => {
    const f = facts({ noEsc: true, swmsBlocker: "Safety plan not signed: Sam", certificate: "missing", clearance: { cleared: false, blocker: "Electrical upgrades not completed yet." } });
    const out = prestartFailures(f);
    expect(out).toContain("Safety plan not signed: Sam");
    expect(out).toContain("Certificate of Electrical Safety not in yet");
    expect(out).toContain("Electrical clearance is not valid: Electrical upgrades not completed yet.");
    expect(out.some((l) => /ESC notification/.test(l))).toBe(false);
  });
});

describe("PIISA timing on a marked job", () => {
  test("marked: the notice lines are skipped, the 30-day PIESA rule still blocks", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-12T22:59:00Z", noticeSentAt: null, piesaCompletedAt: "2026-10-01", noEsc: true })).toEqual([]);
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-11-12T22:59:00Z", noticeSentAt: null, piesaCompletedAt: "2026-10-01", noEsc: true })).toEqual(["PIISA signed more than 30 days after the PIESA (2026-10-01)."]);
  });
  test("unmarked: unchanged", () => {
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-12T22:59:00Z", noticeSentAt: null, piesaCompletedAt: "2026-10-01" })).toEqual(["No ESC notice recorded as sent"]);
    expect(piisaTimingBlockers({ piisaSignedAt: "2026-10-12T22:59:00Z", noticeSentAt: null, piesaCompletedAt: "2026-10-01", noEsc: false })).toEqual(["No ESC notice recorded as sent"]);
  });
});

// ---------- server: a hand-rolled admin client (tables in memory; every write is recorded) ----------
const JOB_MARKED = "00000000-0000-4000-8000-00000000000a", JOB_PLAIN = "00000000-0000-4000-8000-00000000000b", JOB_SENT = "00000000-0000-4000-8000-00000000000c";
const N_MARKED = "00000000-0000-4000-8000-0000000000e1", N_PLAIN = "00000000-0000-4000-8000-0000000000e2", N_SENT = "00000000-0000-4000-8000-0000000000e3";
const START = new Date(Date.now() + 3 * 86_400_000).toISOString();
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let writes: { table: string; op: string; patch: Row }[] = [];
let failReads: string | "all" | null = null; // table whose reads fail, or "all"
const reset = () => {
  failReads = null; writes = [];
  tables = {
    jobs: [
      { id: JOB_MARKED, job_number: "HV-1", source: "website", stage: "ready_for_veec", external_refs: { no_esc: true }, deleted_at: null },
      { id: JOB_PLAIN, job_number: "HV-2", source: "website", stage: "ready_for_veec", external_refs: { owner_agreed_price: true }, deleted_at: null },
      { id: JOB_SENT, job_number: "HV-3", source: "website", stage: "installation_booked", external_refs: null, deleted_at: null },
    ],
    esc_notifications: [
      { id: N_MARKED, job_id: JOB_MARKED, version: 1, status: "ready", scheduled_start: START, sent_at: null, submission_reference: null, consent_id: "c1", payload_json: {}, response: null },
      { id: N_PLAIN, job_id: JOB_PLAIN, version: 1, status: "ready", scheduled_start: START, sent_at: null, submission_reference: null, consent_id: "c2", payload_json: {}, response: null },
      { id: N_SENT, job_id: JOB_SENT, version: 1, status: "sent", scheduled_start: START, sent_at: "2026-11-01T00:00:00Z", submission_reference: "VEU-9", consent_id: "c3", payload_json: {}, response: null },
    ],
    veec_lodgements: [{ job_id: JOB_MARKED, status: "not_submitted", quantity: null, submission_reference: null, submitted_date: null, notes: null }, { job_id: JOB_PLAIN, status: "not_submitted", quantity: null, submission_reference: null, submitted_date: null, notes: null }],
    workflow_events: [], bookings: [], customer_assignments: [], quotes: [],
  };
};
reset();
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op = "select", patch: Row = {}, one: "one" | "maybe" | null = null, lim: number | null = null;
  const run = () => {
    if (failReads === "all" || failReads === table) return { data: null, error: { message: "read failed (test)" } };
    let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (op === "insert") { writes.push({ table, op, patch }); (tables[table] ??= []).push({ id: `ev-${Math.random()}`, ...patch }); rows = [patch]; }
    else if (op === "update") { writes.push({ table, op, patch }); for (const r of rows) Object.assign(r, patch); }
    if (lim != null) rows = rows.slice(0, lim);
    if (one === "one") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
    if (one === "maybe") return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null, count: rows.length };
  };
  const b: Row = {
    select: () => b, order: () => b,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    not: (c: string, o: string, v: unknown) => { filters.push((r) => (o === "is" ? r[c] != null : o === "in" ? !String(v).replace(/[()]/g, "").split(",").includes(String(r[c])) : true)); return b; },
    gt: (c: string, v: string) => { filters.push((r) => String(r[c]) > v); return b; },
    lt: (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return b; },
    contains: () => b, limit: (n: number) => { lim = n; return b; },
    update: (p: Row) => { op = "update"; patch = p; return b; },
    insert: (p: Row) => { op = "insert"; patch = p; return b; },
    single: () => { one = "one"; return b; }, maybeSingle: () => { one = "maybe"; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, storage: { from: () => ({}) } } }));
mock.module("../src/lib/prestart.server", () => ({ runPrestart: async () => null, latestNotices: async () => ({ current: null, previousSent: null }), registryChangeFor: () => null }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null, autoAdvanceOpenJobs: async () => ({}), loadAdvanceFacts: async () => ({}) }));
mock.module("../src/lib/consent.server", () => ({ currentConsent: async () => ({ status: "valid", owner_signed_at: "2026-10-01T00:00:00Z", ap_signed_at: "2026-10-01T00:00:00Z" }) }));
mock.module("../src/lib/install-evidence.server", () => ({ jobProductProblems: async () => [] }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => ({ paid: { install: 20000 } }) }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (f: typeof validate) => { validate = f; return b; }, handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => (a: { data: unknown; context: unknown }) => h({ data: validate(a.data), context: a.context }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { assertNotNoEsc, noEscFor, setNoEscMarker } = await import("../src/lib/no-esc.server");
const robot = await import("../src/lib/esc-registry-robot.server");
const escServer = await import("../src/lib/esc.server");
const { setNoEscMarkerFn } = await import("../src/lib/no-esc.functions");
const events = (job: string) => (tables["workflow_events"] ?? []).filter((e) => e["job_id"] === job).map((e) => String(e["event_type"]));
const noWrites = () => expect(writes).toEqual([]);
const admin = { supabase: { rpc: async () => ({ data: true, error: null }) }, userId: "00000000-0000-4000-8000-0000000000ad" };

beforeEach(reset);

describe("readers", () => {
  test("noEscFor reads the marker; a read failure throws (never 'not marked')", async () => {
    expect(await noEscFor(JOB_MARKED)).toBe(true);
    expect(await noEscFor(JOB_PLAIN)).toBe(false);
    failReads = "jobs";
    await expect(noEscFor(JOB_PLAIN)).rejects.toThrow(/no-ESC marker/);
    await expect(assertNotNoEsc(JOB_PLAIN)).rejects.toThrow(/no-ESC marker/);
  });
  test("assertNotNoEsc throws the refusal on a marked job only", async () => {
    await expect(assertNotNoEsc(JOB_MARKED)).rejects.toThrow(NO_ESC_REFUSAL);
    await expect(assertNotNoEsc(JOB_PLAIN)).resolves.toBeUndefined();
  });
});

describe("robot: a marked job never gets a plan", () => {
  test("noticeWork and veecWork leave the marked job out; the unmarked job is listed as before", async () => {
    const notices = await robot.noticeWork("live");
    expect(notices.map((w) => w.candidate.jobId)).toEqual([JOB_PLAIN]);
    expect(notices[0]!.effectiveMode).not.toBe("off"); // unmarked: live, or dry run until the form is verified
    const veecs = await robot.veecWork("live");
    expect(veecs.map((w) => w.candidate.jobId)).toEqual([JOB_PLAIN]);
    expect(veecs[0]!.candidate.noEsc).toBe(false);
  });
});

describe("recorders refuse a marked job and write nothing", () => {
  const sentAt = new Date().toISOString();
  test("recordRobotNotificationSubmitted", async () => {
    await expect(robot.recordRobotNotificationSubmitted({ notificationId: N_MARKED, reference: "VEU-1", sentAt, screenshotPath: null, registryUrl: null })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
  });
  test("recordRobotNotificationUpdated", async () => {
    await expect(robot.recordRobotNotificationUpdated({ notificationId: N_MARKED, previousNotificationId: N_SENT, reference: "VEU-1", updatedAt: sentAt, screenshotPath: null, registryUrl: null })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
  });
  test("recordRobotVeecSubmitted", async () => {
    await expect(robot.recordRobotVeecSubmitted({ jobId: JOB_MARKED, reference: "VEU-1", quantity: 3, submittedDate: "2026-11-20", screenshotPath: null, registryUrl: null })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
  });
  test("submitEscViaAdapter", async () => {
    await expect(escServer.submitEscViaAdapter(N_MARKED, "actor")).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
    // unmarked: the pre-existing adapter message, byte-identical
    await expect(escServer.submitEscViaAdapter(N_PLAIN, "actor")).rejects.toThrow("No ESC submission adapter is configured. Export the payload, submit it to ESC, then record the submission reference.");
    noWrites();
  });
  test("recordEscSubmission", async () => {
    await expect(escServer.recordEscSubmission({ notificationId: N_MARKED, reference: "VEU-1", sentAt, method: "manual_portal", confirmed: true, actorId: "actor" })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
  });
  test("recordEscRegistryUpdate", async () => {
    await expect(escServer.recordEscRegistryUpdate({ notificationId: N_MARKED, reference: "VEU-1", updatedAt: sentAt, confirmed: true, actorId: "actor" })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
  });
  test("updateVeec to submitted (office)", async () => {
    const { updateVeec } = await import("../src/lib/portal.functions");
    const call = updateVeec as unknown as (a: { data: unknown; context: unknown }) => Promise<unknown>;
    await expect(call({ data: { jobId: JOB_MARKED, quantity: 3, status: "submitted", submission_reference: "VEU-1", submitted_date: "2026-11-20", notes: null }, context: admin })).rejects.toThrow(NO_ESC_REFUSAL);
    noWrites();
    // a note-only save on the marked job still works (nothing goes to the Registry)
    await call({ data: { jobId: JOB_MARKED, quantity: null, status: "not_submitted", submission_reference: null, submitted_date: null, notes: "real run", reason: "note" }, context: admin });
    expect(writes.some((w) => w.table === "veec_lodgements" && w.op === "update")).toBe(true);
  });
  test("the unmarked job's recorder reaches the ordinary checks (not the refusal)", async () => {
    await expect(escServer.recordEscSubmission({ notificationId: N_PLAIN, reference: "VEU-1", sentAt, method: "manual_portal", confirmed: false, actorId: "actor" })).rejects.toThrow("Confirm the notification was actually submitted to ESC.");
  });
});

describe("sweepEscReminders", () => {
  test("a marked job's booking is skipped; a read failure stops the sweep", async () => {
    tables["bookings"] = [{ job_id: JOB_MARKED, kind: "installation", status: "confirmed", scheduled_start: START }, { job_id: JOB_PLAIN, kind: "installation", status: "confirmed", scheduled_start: START }];
    const r = await escServer.sweepEscReminders(new Date());
    expect(r.checked).toBe(1);
    failReads = "jobs";
    await expect(escServer.sweepEscReminders(new Date())).rejects.toThrow(/no-ESC markers/);
  });
});

describe("setNoEscMarker", () => {
  test("marks the job (keeps the other keys), writes one event; a second call changes nothing", async () => {
    const r = await setNoEscMarker(JOB_PLAIN, null, "Part 11 real run");
    expect(r).toEqual({ marked: true, already: false });
    expect(tables["jobs"]!.find((j) => j["id"] === JOB_PLAIN)!["external_refs"]).toEqual({ owner_agreed_price: true, no_esc: true });
    expect(events(JOB_PLAIN)).toEqual([NO_ESC_MARKER_SET_EVENT]);
    const again = await setNoEscMarker(JOB_PLAIN, null, "again");
    expect(again).toEqual({ marked: true, already: true });
    expect(events(JOB_PLAIN)).toEqual([NO_ESC_MARKER_SET_EVENT]);
  });
  test("refused while a sent, un-withdrawn notice exists", async () => {
    await expect(setNoEscMarker(JOB_SENT, null, "late")).rejects.toThrow(NO_ESC_NOTICE_ALREADY_SENT);
    noWrites();
  });
  test("a normal job save that merges external_refs keeps the marker (withNoEscMarker shape)", async () => {
    const refs = tables["jobs"]!.find((j) => j["id"] === JOB_MARKED)!["external_refs"] as Record<string, unknown>;
    expect(noEscMarked({ ...refs, reference: "ABC" })).toBe(true);
  });
  test("server function: office only", async () => {
    const call = setNoEscMarkerFn as unknown as (a: { data: unknown; context: unknown }) => Promise<unknown>;
    await expect(call({ data: { jobId: JOB_PLAIN, reason: "real run" }, context: { supabase: { rpc: async () => ({ data: false, error: null }) }, userId: "u" } })).rejects.toThrow("Admin only.");
    noWrites();
    expect(await call({ data: { jobId: JOB_PLAIN, reason: "real run" }, context: admin })).toEqual({ marked: true, already: false });
  });
});
