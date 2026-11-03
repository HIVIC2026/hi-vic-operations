// Part 2 Task 2: an installer's own job skips the safety check offer and goes to its chosen electrician — exactly once.
// Real rows in PGlite; the payment view, in-house lookup and guarded stage commit are stubbed at their seams.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, stage text, deleted_at timestamptz, source text, offer_dispatch_override text, next_action text, created_at timestamptz default now());
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, ended_at timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role text, approval_status text, removed_at timestamptz, profile_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp(), ended_at timestamptz, end_reason text);
CREATE TABLE partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, kind text, status text, offered_at timestamptz default now(), summary jsonb, expires_at timestamptz, batch int);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const OWN = id(1), OWN2 = id(2), NO_ELEC = id(3), NO_PROFILE = id(4), UNPAID = id(5), LEAD = id(6), INHOUSE = id(7);
const E1 = id(21), E_NOPROFILE = id(22), U1 = id(31);
const paid = new Set([OWN, OWN2, NO_ELEC, NO_PROFILE, LEAD, INHOUSE]);
const heldInHouse = new Set([INHOUSE]);
const notices: string[] = [];
const gateClear = new Set<string>(); // PIESA request gate (original or repeat payment) for jobs at the PIESA stage
const reopenAt = new Map<string, string>();
const mitti = new Map<string, { action: "proceed" } | { action: "use_usual"; businessId: string } | { action: "hold" }>();
let failHandedOnce = false;

await db.query(`insert into jobs (id, channel, stage, source) values
  ($1,'installer_sourced','measured_quote_accepted','real'), ($2,'installer_sourced','measured_quote_accepted','real'),
  ($3,'installer_sourced','measured_quote_accepted','real'), ($4,'installer_sourced','measured_quote_accepted','real'),
  ($5,'installer_sourced','measured_quote_accepted','real'), ($6,'hivic_sourced','measured_quote_accepted','real'),
  ($7,'installer_sourced','measured_quote_accepted','real')`, [OWN, OWN2, NO_ELEC, NO_PROFILE, UNPAID, LEAD, INHOUSE]);
for (const j of [OWN, OWN2, UNPAID, LEAD, INHOUSE]) await db.query("insert into electrician_nominations (job_id, business_id) values ($1,$2)", [j, E1]);
await db.query("insert into electrician_nominations (job_id, business_id) values ($1,$2)", [NO_PROFILE, E_NOPROFILE]);
await db.query("insert into partner_workers (business_id, trade_role, approval_status, profile_id) values ($1,'electrician','approved',$2), ($3,'electrician','approved',null)", [E1, U1, E_NOPROFILE]);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true }));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({
  ...realSuppression,
  readInHouseDispatchState: async () => ({ held: new Set(heldInHouse), failed: false }),
  inHouseDispatchSkip: async (jobId: string, state?: { held: Set<string>; failed: boolean }) => (state?.failed ? "in_house_read_failed" : (state?.held ?? heldInHouse).has(jobId) ? "in_house" : null),
}));
const realPayments = await import("../src/lib/payments.server");
mock.module("../src/lib/payments.server", () => ({ ...realPayments, jobPaymentView: async (jobId: string) => ({ steps: [{ key: "safety_check", state: paid.has(jobId) ? "paid" : "requested" }] }) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    if (failHandedOnce && type === "own_job_piesa_handed") { failHandedOnce = false; throw new Error("database blip"); }
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
  stageEntryBlockers: async () => [],
  piesaRequestFacts: async (job: string) => ({ readyCheckComplete: true, verifiedEligible: true, currentQuoteApproved: true, installerIntakeQualified: true, repeatBlocker: null,
    payment: gateClear.has(job) ? { cleared: true, blocker: "" } : { cleared: false, blocker: "Repeat safety check not paid." } }),
  // Same guard as commit_guarded_stage: the move only happens from the stage that was read.
  transition: async (job: string, to: string) => {
    const from = (await db.query<{ stage: string }>("select stage from jobs where id=$1", [job])).rows[0]!.stage;
    await new Promise((r) => setTimeout(r, 5));
    const r = await db.query("update jobs set stage=$2 where id=$1 and stage=$3 returning id", [job, to, from]);
    if (!r.rows.length || from === to) throw new realWorkflow.WorkflowError("Job changed concurrently");
    await db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,'stage_changed','moved','{}')", [job]);
  },
}));
const realRepeat = await import("../src/lib/repeat-piesa.server");
mock.module("../src/lib/repeat-piesa.server", () => ({ ...realRepeat, latestReopenAt: async (j: string) => reopenAt.get(j) ?? null }));
const realMitti = await import("../src/lib/mitti-electrician.server");
mock.module("../src/lib/mitti-electrician.server", () => ({ ...realMitti, mittiElectricianAtSafetyCheck: async (j: string) => {
  const m = mitti.get(j) ?? { action: "proceed" };
  if (m.action === "hold") await db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,'mitti_electrician_choice_needed','Installer to choose electrician','{\"needs_office\":true}')", [j]);
  return m;
} }));
mock.module("../src/lib/own-job-piesa-notices.server", () => ({ sendOwnJobPiesaNotices: async (j: string) => { notices.push(j); return "stub"; } }));

const { handOwnJobPiesa, sweepOwnJobPiesaHandoffs } = await import("../src/lib/own-job-piesa.server");
const { autoOfferForJob } = await import("../src/lib/auto-offer.server");
const { startPiesaAllocation } = await import("../src/lib/allocation.server");
const { OWN_JOB_CALL_AND_BOOK } = await import("../src/lib/own-job-piesa.core");

const n = async (sql: string, vals: unknown[] = []) => (await db.query<{ n: number }>(sql, vals)).rows[0]!.n;
const assignments = (j: string) => n("select count(*)::int n from job_assignments where job_id=$1 and role='electrician' and active", [j]);
const events = (j: string, t: string) => n("select count(*)::int n from workflow_events where job_id=$1 and event_type=$2", [j, t]);
const stage = async (j: string) => (await db.query<{ stage: string }>("select stage from jobs where id=$1", [j])).rows[0]!.stage;
const now = new Date("2026-11-04T01:00:00Z"); // Wed 4 Nov 2026, 12pm Melbourne

describe("own job safety check hand-over", () => {
  test("a paid own job is handed exactly once across two sweeps (owner paid twice)", async () => {
    const first = await sweepOwnJobPiesaHandoffs(now);
    const second = await sweepOwnJobPiesaHandoffs(now);
    expect(first.handed).toBe(2); // OWN and OWN2
    expect(second.handed).toBe(0);
    expect(await assignments(OWN)).toBe(1);
    expect(await events(OWN, "own_job_piesa_handed")).toBe(1);
    expect(await stage(OWN)).toBe("piesa_and_install_window_pending");
    expect(await handOwnJobPiesa(OWN, now)).toBe("already");
    const a = (await db.query<{ business_id: string; user_id: string }>("select business_id, user_id from job_assignments where job_id=$1", [OWN])).rows;
    expect(a).toEqual([{ business_id: E1, user_id: U1 }]);
    const d = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_handed'", [OWN])).rows[0]!.details;
    // 2 Victorian business days from Wed 4 Nov → end of Fri 6 Nov (Melbourne).
    expect(d).toMatchObject({ electrician_business_id: E1, due_at: "2026-11-06T12:59:59.999Z" });
    expect(notices.filter((j) => j === OWN)).toHaveLength(2); // the hand-over sends once; the second sweep re-checks (the real notices skip anything already sent)
  });

  test("two hand-overs racing (Xero and Stripe at once) still hand over once", async () => {
    const RACE = id(8);
    paid.add(RACE);
    await db.query("insert into jobs (id, channel, stage, source) values ($1,'installer_sourced','measured_quote_accepted','real')", [RACE]);
    await db.query("insert into electrician_nominations (job_id, business_id) values ($1,$2)", [RACE, E1]);
    const out = await Promise.all([handOwnJobPiesa(RACE, now), handOwnJobPiesa(RACE, now)]);
    expect(out.filter((o) => o === "handed")).toHaveLength(1);
    expect(await n("select count(*)::int n from job_assignments where job_id=$1", [RACE])).toBe(1);
    expect(await events(RACE, "own_job_piesa_handed")).toBe(1);
  });

  test("no electrician chosen → one office item, no assignment", async () => {
    await sweepOwnJobPiesaHandoffs(now);
    expect(await assignments(NO_ELEC)).toBe(0);
    const held = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_held'", [NO_ELEC])).rows;
    expect(held).toHaveLength(1);
    expect(held[0]!.details).toMatchObject({ reason: "No electrician chosen for this job", needs_office: true });
    expect(await stage(NO_ELEC)).toBe("measured_quote_accepted");
  });

  test("electrician worker with no portal profile → one office item, never a broken assignment", async () => {
    expect(await handOwnJobPiesa(NO_PROFILE, now)).toBe("held");
    expect(await assignments(NO_PROFILE)).toBe(0);
    const held = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_held'", [NO_PROFILE])).rows;
    expect(held).toHaveLength(1);
    expect(held[0]!.details).toMatchObject({ reason: "Electrician has no portal profile" });
  });

  test("unpaid → waits, nothing written", async () => {
    expect(await handOwnJobPiesa(UNPAID, now)).toBe("waiting");
    expect(await assignments(UNPAID)).toBe(0);
    expect(await n("select count(*)::int n from workflow_events where job_id=$1", [UNPAID])).toBe(0);
  });

  test("autoOfferForJob creates no offer for an own job", async () => {
    const sw = { ready_check: true, piesa: true, readyCheckBooking: true };
    for (const j of [UNPAID, OWN]) {
      const r = await autoOfferForJob(j, "piesa", sw);
      expect(r).toMatchObject({ step: "none", reason: OWN_JOB_CALL_AND_BOOK });
    }
    // Even with the switch off: no "returned to office" hand-back for own jobs.
    expect((await autoOfferForJob(UNPAID, "piesa", { ...sw, piesa: false })).reason).toBe(OWN_JOB_CALL_AND_BOOK);
    expect(await n("select count(*)::int n from partner_offers")).toBe(0);
  });

  test("startPiesaAllocation returns early for an own job", async () => {
    const r = await startPiesaAllocation(UNPAID, null, "piesa");
    expect(r).toMatchObject({ offered: 0, ok: false, reason: OWN_JOB_CALL_AND_BOOK });
    expect(await n("select count(*)::int n from partner_offers")).toBe(0);
  });

  test("the owner's safety check times email is skipped for own jobs only", async () => {
    const { onSafetyCheckTimesOffered } = await import("../src/lib/owner-email-triggers.server");
    expect(await onSafetyCheckTimesOffered(OWN, ["2026-11-10T00:00:00Z"])).toBe("own_job");
    expect(await onSafetyCheckTimesOffered(INHOUSE, ["2026-11-10T00:00:00Z"])).toBe("in_house");
  });

  // ---- fix round 1 ----
  const newJob = async (n2: number, stg: string, opts: { nominate?: string | null; paidFee?: boolean } = {}) => {
    const j = id(n2);
    await db.query("insert into jobs (id, channel, stage, source) values ($1,'installer_sourced',$2,'real')", [j, stg]);
    if (opts.nominate !== undefined) await db.query("insert into electrician_nominations (job_id, business_id) values ($1,$2)", [j, opts.nominate]);
    if (opts.paidFee !== false) paid.add(j);
    return j;
  };

  test("a reopened own job is handed to the electrician again; the repeat round is keyed separately", async () => {
    const J = await newJob(40, "measured_quote_accepted", { nominate: E1 });
    expect(await handOwnJobPiesa(J, now)).toBe("handed");
    // Office reopens: the job is back waiting for a safety check, the first electrician's row is still active.
    reopenAt.set(J, new Date(Date.now() + 1000).toISOString());
    await new Promise((r) => setTimeout(r, 1100));
    expect(await handOwnJobPiesa(J, now)).toBe("waiting"); // repeat check not paid yet
    gateClear.add(J);
    expect(await handOwnJobPiesa(J, now)).toBe("handed");
    expect(await handOwnJobPiesa(J, now)).toBe("already");
    const keys = (await db.query<{ k: string }>("select details->>'key' k from workflow_events where job_id=$1 and event_type='own_job_piesa_handed' order by created_at", [J])).rows.map((r) => r.k);
    expect(keys).toEqual([`own_job_piesa:${J}:first`, `own_job_piesa:${J}:${reopenAt.get(J)}`]);
    expect(await assignments(J)).toBe(1);
    expect(await n("select count(*)::int n from job_assignments where job_id=$1 and not active and end_reason='reassigned'", [J])).toBe(1);
    expect(notices.filter((x) => x === J)).toHaveLength(2);
  });

  test("an in-flight own job at the PIESA stage (old path, no electrician) is handed once its pending offer is gone", async () => {
    const J = await newJob(41, "piesa_and_install_window_pending", { nominate: E1 });
    gateClear.add(J);
    await db.query("insert into partner_offers (job_id, business_id, kind, status) values ($1,$2,'piesa','pending')", [J, E1]);
    expect(await handOwnJobPiesa(J, now)).toBe("waiting");
    await db.query("update partner_offers set status='expired' where job_id=$1", [J]);
    expect(await handOwnJobPiesa(J, now)).toBe("handed");
    expect(await assignments(J)).toBe(1);
  });

  test("half-done hand-over (event write failed after the move) is completed by the next sweep, once", async () => {
    const J = await newJob(42, "measured_quote_accepted", { nominate: E1 });
    failHandedOnce = true;
    await expect(handOwnJobPiesa(J, now)).rejects.toThrow("database blip");
    expect(await stage(J)).toBe("piesa_and_install_window_pending");
    expect(await assignments(J)).toBe(1);
    expect(await events(J, "own_job_piesa_handed")).toBe(0);
    expect(notices.filter((x) => x === J)).toHaveLength(0);
    gateClear.add(J); // the paid gate is clear for the repair
    const later = new Date("2026-11-05T01:00:00Z"); // Thu → due end of Mon 9 Nov
    await sweepOwnJobPiesaHandoffs(later);
    await sweepOwnJobPiesaHandoffs(later);
    expect(await events(J, "own_job_piesa_handed")).toBe(1);
    expect(notices.filter((x) => x === J)).toHaveLength(2); // hand-over + one retry call
    expect(await assignments(J)).toBe(1);
    const d = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_handed'", [J])).rows[0]!.details;
    expect(d).toMatchObject({ electrician_business_id: E1, electrician_user_id: U1, due_at: "2026-11-09T12:59:59.999Z", repaired: true });
  });

  test("repair: a round whose paid gate is not clear gets no hand-over event and no notices", async () => {
    const J = await newJob(142, "measured_quote_accepted", { nominate: E1 });
    failHandedOnce = true;
    await expect(handOwnJobPiesa(J, now)).rejects.toThrow("database blip");
    const before = notices.filter((x) => x === J).length;
    expect(await handOwnJobPiesa(J, now)).toBe("waiting");
    expect(await events(J, "own_job_piesa_handed")).toBe(0);
    expect(notices.filter((x) => x === J)).toHaveLength(before);
  });

  test("no nomination: a Mitti pickup uses the installer's approved usual electrician", async () => {
    const J = await newJob(43, "measured_quote_accepted");
    mitti.set(J, { action: "use_usual", businessId: E1 });
    expect(await handOwnJobPiesa(J, now)).toBe("handed");
    expect((await db.query("select business_id from job_assignments where job_id=$1 and active", [J])).rows).toEqual([{ business_id: E1 }]);
  });

  test("no nomination and the Mitti fallback holds: its own office item, not ours, and no assignment", async () => {
    const J = await newJob(44, "measured_quote_accepted");
    mitti.set(J, { action: "hold" });
    expect(await handOwnJobPiesa(J, now)).toBe("held");
    expect(await events(J, "mitti_electrician_choice_needed")).toBe(1);
    expect(await events(J, "own_job_piesa_held")).toBe(0);
    expect(await assignments(J)).toBe(0);
  });

  test("nominated electrician not onboarded (no business) → 'Electrician hasn't finished signing up'", async () => {
    const J = await newJob(45, "measured_quote_accepted", { nominate: null });
    expect(await handOwnJobPiesa(J, now)).toBe("held");
    const held = (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_held'", [J])).rows;
    expect(held).toHaveLength(1);
    expect(held[0]!.details).toMatchObject({ reason: "Electrician hasn't finished signing up" });
    expect(await assignments(J)).toBe(0);
  });

  test("office offer buttons refuse own jobs with a plain message", async () => {
    const { refuseOfficeOfferForOwnJob } = await import("../src/lib/own-job-piesa.server");
    await expect(refuseOfficeOfferForOwnJob(UNPAID)).rejects.toThrow("This is the installer's own job — it goes straight to their electrician");
    await expect(refuseOfficeOfferForOwnJob(LEAD)).resolves.toBeUndefined();
    await expect(refuseOfficeOfferForOwnJob(INHOUSE)).resolves.toBeUndefined();
  });

  test("HIV lead and in-house partner jobs keep their current flow", async () => {
    // Never handed by the sweep (both are paid and have an electrician nominated).
    expect(await assignments(LEAD)).toBe(0);
    expect(await assignments(INHOUSE)).toBe(0);
    expect(await n("select count(*)::int n from workflow_events where job_id = any($1)", [[LEAD, INHOUSE]])).toBe(0);
    expect(await handOwnJobPiesa(LEAD, now)).toBe("waiting");
    expect(await handOwnJobPiesa(INHOUSE, now)).toBe("waiting");
    // autoOfferForJob takes its old path: the switch decides for an HIV lead, the in-house skip for an in-house job.
    const off = { ready_check: false, piesa: false, readyCheckBooking: false };
    expect((await autoOfferForJob(LEAD, "piesa", off)).reason).toBe("switch_off");
    expect((await autoOfferForJob(INHOUSE, "piesa", off)).reason).toBe("in_house");
    expect(await stage(LEAD)).toBe("measured_quote_accepted");
    expect(await stage(INHOUSE)).toBe("measured_quote_accepted");
  });
});
