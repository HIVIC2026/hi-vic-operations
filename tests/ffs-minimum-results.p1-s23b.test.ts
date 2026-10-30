// P1-S23B — FFS (approved partner businessAdmin) minimum field progress / result recording.
//
// Fake in-memory backend; no network, no database, no emails. The ONLY thing mocked is the
// Supabase admin client, so the real authorisation chain (tradeContext -> requireTradeJob -> boss
// check) and the real persistence path (logEvent -> workflow_events) are exercised end to end.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;

const JOB = "11111111-1111-4111-8111-111111111111";
const OTHER_JOB = "22222222-2222-4222-8222-222222222222";
const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FFS_BOSS = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // business_admin of BIZ_A, no trade role
const WORKER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // staff member of BIZ_A
const OUTSIDER = "99999999-9999-4999-8999-999999999999"; // no business at all

const db: Record<string, Row[]> = {};
let uid = 0;
const now = () => new Date(Date.now() + ++uid).toISOString();

function reset(over: Partial<Record<string, Row[]>> = {}) {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    businesses: [
      { id: BIZ_A, name: "FFS Partner A", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: null, onboarding_notes: null, mitti_account_invited: null },
      { id: BIZ_B, name: "Other Partner B", business_type: "eec_installer", capabilities: null, base_suburb: null, coverage_radius_km: null, covers_all_victoria: null, accepting_new_jobs: null, onboarding_notes: null, mitti_account_invited: null },
    ],
    business_members: [
      { user_id: FFS_BOSS, business_id: BIZ_A, member_role: "business_admin", active: true },
      { user_id: WORKER, business_id: BIZ_A, member_role: "worker", active: true },
    ],
    user_roles: [] as Row[],
    profiles: [{ id: FFS_BOSS, full_name: "Fran Ffs", phone: null, email: null }],
    jobs: [{ id: JOB, stage: "installation_booked", source: "web", last_activity_at: null }],
    job_assignments: [{ id: `a${++uid}`, job_id: JOB, business_id: BIZ_A, user_id: WORKER, role: "installer", active: true }],
    workflow_events: [] as Row[],
    customer_email_sends: [] as Row[],
    job_communications: [] as Row[],
    external_action_outbox: [] as Row[],
    ...over,
  });
  // PostgREST embed read by tradeContext (`business_members → businesses(...)`), kept live against the businesses rows.
  for (const m of db["business_members"]!) Object.defineProperty(m, "businesses", { enumerable: true, configurable: true, get: () => (db["businesses"] ?? []).find((b) => b["id"] === m["business_id"]) ?? null });
}

function q(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null, ins: Row | null = null;
  let orderKey: string | null = null, orderAsc = true, lim: number | null = null;
  const rows = () => (db[table] ??= []).filter((r) => f.every((p) => p(r)));
  const exec = () => {
    if (ins) {
      const r = { id: `${table}-${++uid}`, created_at: now(), ...ins };
      db[table]!.push(r);
      return { data: [r], error: null };
    }
    if (patch) {
      const rs = rows();
      rs.forEach((r) => Object.assign(r, patch));
      return { data: rs, error: null };
    }
    let out = rows();
    if (orderKey) out = [...out].sort((a, b) => String(a[orderKey!]).localeCompare(String(b[orderKey!])) * (orderAsc ? 1 : -1));
    if (lim != null) out = out.slice(0, lim);
    return { data: out, error: null };
  };
  const api: any = {
    select: () => api,
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { f.push((r) => v.includes(r[k])); return api; },
    order: (k: string, o?: { ascending?: boolean }) => { orderKey = k; orderAsc = o?.ascending !== false; return api; },
    limit: (n: number) => { lim = n; return api; },
    insert: (r: Row) => { ins = r; return api; },
    update: (p: Row) => { patch = p; return api; },
    single: async () => ({ data: exec().data?.[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
    then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
  };
  return api;
}

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q, rpc: async () => ({ data: null, error: null }) } }));

const { recordFfsProgress, listFfsProgress } = await import("../src/lib/ffs-progress.server");
const { buildTimeline, visibleTo } = await import("../src/lib/jobfile.core");
const { tradeJobAllowed } = await import("../src/lib/trade-view.core");
const { FFS_PROGRESS_EVENT } = await import("../src/lib/ffs-progress.core");

const events = () => (db["workflow_events"] ?? []) as Row[];
const ffsEvents = () => events().filter((e) => e["event_type"] === FFS_PROGRESS_EVENT);
const job = () => (db["jobs"] ?? [])[0]!;
const asErr = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message);

// ---------------------------------------------------------------- authorisation

describe("TEST 1 — an authorised FFS businessAdmin can record a result", () => {
  test("submitting a valid result persists one FFS event", async () => {
    reset();
    const out = await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "Attended site, measured up, no hazards seen." });
    expect(out.ok).toBe(true);
    expect(ffsEvents()).toHaveLength(1);
    expect(out.record.result).toBe("site_visited");
    expect(out.record.note).toBe("Attended site, measured up, no hazards seen.");
    expect(out.record.businessId).toBe(BIZ_A);
  });
});

describe("TEST 2 — an unauthenticated / unlinked caller is rejected", () => {
  test("a caller with no business membership cannot record", async () => {
    reset();
    expect(await asErr(recordFfsProgress(OUTSIDER, JOB, { result: "site_visited", note: "hello" }))).toMatch(/isn't linked to an approved business/i);
    expect(ffsEvents()).toHaveLength(0);
  });
  test("an empty user id is rejected before any write", async () => {
    reset();
    expect(await asErr(recordFfsProgress("", JOB, { result: "site_visited", note: "hello" }))).toBeTruthy();
    expect(ffsEvents()).toHaveLength(0);
  });
});

describe("TEST 3 — a non-FFS actor cannot use the FFS write path", () => {
  test("a business staff member (not the business admin) is refused", async () => {
    reset();
    expect(await asErr(recordFfsProgress(WORKER, JOB, { result: "progress_made", note: "half done" }))).toMatch(/Only the business admin/i);
    expect(ffsEvents()).toHaveLength(0);
  });
  test("an inactive business member is refused", async () => {
    reset({ business_members: [{ user_id: FFS_BOSS, business_id: BIZ_A, member_role: "business_admin", active: false }] });
    expect(await asErr(recordFfsProgress(FFS_BOSS, JOB, { result: "progress_made", note: "half done" }))).toBeTruthy();
    expect(ffsEvents()).toHaveLength(0);
  });
  test("the read path reports canRecord=false for staff instead of granting the write", async () => {
    reset();
    const out = await listFfsProgress(WORKER, JOB);
    expect(out.canRecord).toBe(false);
  });
});

describe("TEST 4 — cross-business job submission is rejected", () => {
  test("a job assigned only to another business cannot be written to", async () => {
    reset({ job_assignments: [{ id: "ax", job_id: JOB, business_id: BIZ_B, user_id: WORKER, role: "installer", active: true }] });
    expect(await asErr(recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "not mine" }))).toMatch(/isn't assigned to you/i);
    expect(ffsEvents()).toHaveLength(0);
  });
  test("an ended (inactive) assignment on the job is rejected", async () => {
    reset({ job_assignments: [{ id: "ax", job_id: JOB, business_id: BIZ_A, user_id: WORKER, role: "installer", active: false }] });
    expect(await asErr(recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "ended" }))).toMatch(/isn't assigned to you/i);
    expect(ffsEvents()).toHaveLength(0);
  });
});

describe("TEST 5 — an invalid job id is rejected", () => {
  test("non-uuid and unknown job ids never reach the write", async () => {
    reset();
    for (const bad of ["not-a-uuid", "", `${JOB}'; drop table jobs;--`]) {
      expect(await asErr(recordFfsProgress(FFS_BOSS, bad, { result: "site_visited", note: "x" }))).toBeTruthy();
    }
    expect(await asErr(recordFfsProgress(FFS_BOSS, OTHER_JOB, { result: "site_visited", note: "x" }))).toMatch(/isn't assigned to you/i);
    expect(ffsEvents()).toHaveLength(0);
  });
});

describe("TEST 6 — an invalid or unsupported result is rejected", () => {
  test("unknown category, blank note and an over-long note are refused", async () => {
    reset();
    const msg = async (i: unknown) => asErr(recordFfsProgress(FFS_BOSS, JOB, i as never));
    expect(await msg({ result: "installation_complete", note: "done" })).toMatch(/Unsupported FFS result/i);
    expect(await msg({ result: null, note: "done" })).toMatch(/Unsupported FFS result/i);
    expect(await msg({ result: "site_visited", note: "   " })).toMatch(/short note/i);
    expect(await msg({ result: "site_visited", note: "x".repeat(501) })).toMatch(/500 characters/i);
    expect(ffsEvents()).toHaveLength(0);
  });
  test("every supported category is accepted", async () => {
    for (const r of ["site_visited", "progress_made", "issue_found", "awaiting_access"]) {
      reset();
      await recordFfsProgress(FFS_BOSS, JOB, { result: r, note: "ok" });
      expect(ffsEvents()[0]!["details"]!["result"]).toBe(r);
    }
  });
});

// ---------------------------------------------------------------- persistence + office

describe("TEST 7 — the result is persisted against the correct job", () => {
  test("event.job_id is the submitted job and the actor is the signed-in user", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "issue_found", note: "Downlights need covers before install." });
    const e = ffsEvents()[0]!;
    expect(e["job_id"]).toBe(JOB);
    expect(e["actor_id"]).toBe(FFS_BOSS);
    expect(e["internal"]).toBe(true); // office-only: never shown to the homeowner or other trades
  });
});

describe("TEST 8 — the result stays available after a later retrieval", () => {
  test("listFfsProgress returns the stored record with its note and label", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "progress_made", note: "Insulation delivered to site." });
    const out = await listFfsProgress(FFS_BOSS, JOB);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.note).toBe("Insulation delivered to site.");
    expect(out.items[0]!.label).toBe("Progress made");
    expect(out.items[0]!.actorId).toBe(FFS_BOSS);
    expect(out.canRecord).toBe(true);
  });
  test("the newest record comes back first", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "first" });
    await recordFfsProgress(FFS_BOSS, JOB, { result: "issue_found", note: "second" });
    const out = await listFfsProgress(FFS_BOSS, JOB);
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.note).toBe("second");
  });
});

describe("TEST 9 — the recorded FFS result is persisted but never user-visible (P1-FA02)", () => {
  test("the stored event keeps its full data, yet no user-facing timeline renders it — admin included", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "awaiting_access", note: "Owner not home; left a card." });
    // Persistence is unchanged by P1-FA02: one internal event with result, note, actor, time, business.
    const stored = ffsEvents()[0]!;
    expect(String(stored["summary"])).toContain("FFS update");
    expect(String(stored["summary"])).toContain("Couldn't get access");
    expect(stored["actor_id"]).toBe(FFS_BOSS);
    expect(stored["created_at"]).toBeTruthy();
    expect(JSON.stringify(stored["details"])).toContain("Owner not home; left a card.");
    expect(JSON.stringify(stored["details"])).toContain("awaiting_access");
    expect(JSON.stringify(stored["details"])).toContain("FFS Partner A");
    // P1-FA02 (owner decision, 14 Oct 2026): FFS is not a user-facing role, so the presentation
    // boundary excludes the event from every timeline — the office admin included.
    const rows = events().map((e) => ({ ...e, details: e["details"] ?? {} }));
    const items = visibleTo(buildTimeline({ events: rows as never, correspondence: [], bookings: [], evidence: [] }), "admin");
    expect(items.filter((i) => i.id.startsWith("workflow_events:"))).toHaveLength(0);
  });
  test("it is NOT shown to the homeowner, installer or electrician (internal)", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "issue_found", note: "internal note" });
    const rows = events().map((e) => ({ ...e, details: e["details"] ?? {} }));
    const all = buildTimeline({ events: rows as never, correspondence: [], bookings: [], evidence: [] });
    for (const role of ["owner", "installer", "electrician"] as const) {
      expect(visibleTo(all, role).filter((i) => i.id.startsWith("workflow_events:"))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------- boundaries

describe("TEST 10 — FFS recording does not complete an install or an electrical result", () => {
  test("no completion event is written and the job stage is unchanged", async () => {
    reset();
    const before = job()["stage"];
    await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "all good" });
    expect(job()["stage"]).toBe(before);
    expect(events().filter((e) => /complete|completion|piesa|assessment|sign_off/i.test(String(e["event_type"])))).toHaveLength(0);
    expect(ffsEvents()[0]!["from_stage"] ?? null).toBe(null);
    expect(ffsEvents()[0]!["to_stage"] ?? null).toBe(null);
  });
});

describe("TEST 11 — FFS recording sends nothing to the customer", () => {
  test("no email, SMS, outbox or communication row is created", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "progress_made", note: "on track" });
    expect(db["customer_email_sends"]).toHaveLength(0);
    expect(db["job_communications"]).toHaveLength(0);
    expect(db["external_action_outbox"]).toHaveLength(0);
  });
});

describe("TEST 12 — installer workflows remain valid", () => {
  test("the shared trade access rule still admits an assigned installer", () => {
    expect(tradeJobAllowed({
      signedIn: true, userId: WORKER, businessId: BIZ_A, boss: false, jobId: JOB,
      assignments: [{ job_id: JOB, business_id: BIZ_A, user_id: WORKER, active: true }],
    })).toBe(true);
    expect(tradeJobAllowed({
      signedIn: true, userId: WORKER, businessId: BIZ_B, boss: false, jobId: JOB,
      assignments: [{ job_id: JOB, business_id: BIZ_A, user_id: WORKER, active: true }],
    })).toBe(false);
  });
  test("the field job page still renders the installer flow", () => {
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).toContain("InstallerFlow");
    expect(page).toContain("role === \"installer\"");
  });
});

describe("TEST 13 — electrician workflows remain valid", () => {
  test("the field job page still renders the electrician flow", () => {
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).toContain("ElectricianFlow");
    expect(page).toContain("role === \"electrician\"");
  });
  test("no electrician completion can be produced by the FFS path", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "checked" });
    expect(events().filter((e) => /electrician/i.test(String(e["event_type"])))).toHaveLength(0);
  });
});

describe("TEST 14 — existing FFS read access is unchanged", () => {
  test("the /field guard still admits a businessAdmin and rejects a bare owner", () => {
    const guard = readFileSync("src/routes/_authenticated/field.tsx", "utf8");
    expect(guard).toMatch(/a\.admin \|\| a\.installer \|\| a\.electrician \|\| a\.businessAdmin/);
    const access = readFileSync("src/lib/route-guards.ts", "utf8");
    expect(access).toContain('.eq("member_role", "business_admin")');
  });
  test("FFS recording grants no new role or assignment", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "x" });
    expect(db["user_roles"]).toHaveLength(0);
    expect(db["job_assignments"]).toHaveLength(1);
  });
});

describe("TEST 15 — no cross-business data exposure", () => {
  test("a record left by another business on the same job is never returned", async () => {
    reset();
    await recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "ours" });
    (db["workflow_events"] as Row[]).push({
      id: "foreign", job_id: JOB, actor_id: OUTSIDER, event_type: FFS_PROGRESS_EVENT, created_at: now(), internal: true,
      summary: "FFS update · Site visited — theirs",
      details: { result: "site_visited", note: "theirs", business_id: BIZ_B, business_name: "Other Partner B", source: "ffs_field" },
    });
    const out = await listFfsProgress(FFS_BOSS, JOB);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.note).toBe("ours");
  });
  test("the write path never accepts another business's job", async () => {
    reset({ job_assignments: [
      { id: "a1", job_id: JOB, business_id: BIZ_B, user_id: WORKER, role: "installer", active: true },
      { id: "a2", job_id: OTHER_JOB, business_id: BIZ_A, user_id: WORKER, role: "installer", active: true },
    ] });
    expect(await asErr(recordFfsProgress(FFS_BOSS, JOB, { result: "site_visited", note: "x" }))).toBeTruthy();
    await recordFfsProgress(FFS_BOSS, OTHER_JOB, { result: "site_visited", note: "mine" });
    expect(ffsEvents()[0]!["job_id"]).toBe(OTHER_JOB);
  });
});

// ---------------------------------------------------------------- source pins

describe("P1-S23B source pins (narrow, informational, no new schema)", () => {
  const server = readFileSync("src/lib/ffs-progress.server.ts", "utf8");
  const core = readFileSync("src/lib/ffs-progress.core.ts", "utf8");
  const fn = readFileSync("src/lib/ffs-progress.functions.ts", "utf8");

  test("authorisation reuses the existing trade context and job-assignment rule", () => {
    expect(server).toContain("ctxOrThrow");
    expect(server).toContain("requireTradeJob");
    expect(server).toContain("c.boss");
  });
  test("the record is one internal workflow event — no stage change, no schema change", () => {
    expect(server).toContain("internal: true");
    expect(server).not.toMatch(/from:\s*["'][a-z_]+["']|to:\s*["'][a-z_]+["']/);
    expect(core).toContain('export const FFS_PROGRESS_EVENT = "ffs_progress_result"');
    expect(core).not.toMatch(/create table|alter table|create policy|grant /i);
  });
  test("no customer messaging, completion, payment or assignment side effects", () => {
    for (const bad of ["customer_email_sends", "sendEmail", "job_communications", "completeInstallation", "recordPiesa", "payments", "job_assignments\")\n    .insert"]) {
      expect(server.includes(bad) || fn.includes(bad)).toBe(false);
    }
  });
  test("the write path is a validated server function", () => {
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("z.string().uuid()");
  });
});
