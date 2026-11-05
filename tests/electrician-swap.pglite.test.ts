// Part 2 Task 5: the installer swaps the electrician on its own job. Real rows in PGlite; the stage writer, Mitti, the
// booking-time texts and the email sender are stubbed at their seams. The link table and link rules are the real ones.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { addMelbourneBusinessDays } from "../src/lib/melbourne-time.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, owner_id uuid, external_refs jsonb, electrician_choice text, created_at timestamptz default clock_timestamp());
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, mobile text, email text, trade_role text default 'electrician', approval_status text default 'approved', created_at timestamptz default clock_timestamp(), removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp(), ended_at timestamptz, end_reason text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, business_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
CREATE TABLE contact_releases (id uuid primary key default gen_random_uuid(), job_id uuid, assignment_id uuid, visit_kind text, revoked_at timestamptz);
CREATE TABLE electrician_job_links (id uuid primary key default gen_random_uuid(), job_id uuid, electrician_business_id uuid, token_hash text unique, created_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz, revoked_reason text);
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, nominating_business_id uuid, nominated_by uuid, nominated_for text, contact_name text, business_name text, email text, phone text, status text, created_at timestamptz default clock_timestamp(), updated_at timestamptz, ended_at timestamptz);
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid, electrician_business_id uuid, active boolean default true);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE owners (id uuid primary key, full_name text, email text);
CREATE TABLE customer_email_optouts (job_id uuid, opted_out_at timestamptz);
CREATE TABLE lead_campaign_responses (job_id uuid, opted_out_at timestamptz);
CREATE TABLE customer_engagement_events (id uuid primary key default gen_random_uuid(), job_id uuid, event_type text);
CREATE TABLE customer_email_sends (id uuid primary key default gen_random_uuid(), job_id uuid, purpose text, idempotency_key text unique, status text default 'sending', provider text, sent_at timestamptz, error text, provider_message_id text);
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb);
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, external_mitti_id text);
-- Jo 5 Nov 2026: swapOptions reads the ONE Electricians list (installer-electricians.server) — the live columns it reads.
ALTER TABLE partner_relationships ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE businesses ADD COLUMN onboarding_status text, ADD COLUMN is_active boolean, ADD COLUMN IF NOT EXISTS rec_number text;
ALTER TABLE partner_workers ADD COLUMN licence_number text, ADD COLUMN rec_number text, ADD COLUMN licence_expires_on text, ADD COLUMN licence_verified_at timestamptz;
ALTER TABLE admin_config_events ADD COLUMN created_at timestamptz DEFAULT clock_timestamp();
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), OLD = id(2), NEW = id(3), UNLINKED = id(4), UNBOARDED = id(5), OTHER_INST = id(6), NEW2 = id(7);
const UOLD = id(12), UNEW = id(13), UNEW2 = id(14), BOSS = id(20);
const J_BOOKED = id(101), J_TOBOOK = id(102), J_DONE = id(103), J_REC = id(104), J_EARLY = id(105), J_LEAD = id(106), J_FORM = id(107), J_RESUME = id(108), J_RACE = id(109), J_FORM2 = id(110);
for (const [b, n, e] of [[INST, "Reinsulate", "office@reinsulate.test"], [OLD, "Old Sparky", "old@sparky.test"], [NEW, "New Sparky", "new@sparky.test"], [UNLINKED, "Stranger", null], [UNBOARDED, "Newbie", null], [OTHER_INST, "Other", null], [NEW2, "Second Sparky", "second@sparky.test"]] as const)
  await db.query("insert into businesses values ($1,$2,$2,$3,null,null)", [b, n, e]);
await db.query("insert into partner_workers (business_id, profile_id, full_legal_name, email) values ($1,$2,'Old Sam','oldsam@x.test'), ($3,$4,'New Nic','newnic@x.test'), ($5,$6,'Second Sue','sue@x.test')", [OLD, UOLD, NEW, UNEW, NEW2, UNEW2]);
await db.query("insert into partner_relationships (installer_business_id, electrician_business_id) values ($1,$2), ($1,$3), ($1,$4), ($1,$5)", [INST, OLD, NEW, UNBOARDED, NEW2]);
const OWNER = id(30), J_TEST = id(201), J_OPTOUT = id(202), J_RETRY = id(203), J_HELD = id(204), J_OLDHELD = id(205), J_OB = id(206), J_NB = id(207);
await db.query("insert into owners values ($1,'Olive Owner','olive@owner.test')", [OWNER]);
const seed = async (job: string, o: { stage?: string; channel?: string; booked?: boolean; source?: string } = {}) => {
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source, owner_id) values ($1,$2,$3,$4,$5,$6)", [job, o.stage ?? "piesa_and_install_window_pending", INST, o.channel ?? "installer_sourced", o.source ?? "real", OWNER]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id, booking_confirmed_at) values ($1,'electrician',$2,$3,$4)", [job, OLD, UOLD, o.booked ? new Date().toISOString() : null]);
  await db.query("insert into electrician_nominations (job_id, business_id, nominating_business_id, status) values ($1,$2,$3,'approved')", [job, OLD, INST]);
  await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'own_job_piesa_handed','handed',$2,true)", [job, JSON.stringify({ key: `own_job_piesa:${job}:first`, due_at: "2026-01-01T00:00:00Z" })]);
  await db.query("insert into electrician_job_links (job_id, electrician_business_id, token_hash, expires_at) values ($1,$2,$3,now() + interval '30 days')", [job, OLD, `hash-${job}`]);
  await db.query("insert into contact_releases (job_id, assignment_id, visit_kind) select $1, id, 'piesa' from job_assignments where job_id=$1", [job]);
};
for (const j of [J_TOBOOK, J_REC, J_LEAD, J_FORM, J_RESUME, J_RACE, J_FORM2]) await seed(j, j === J_LEAD ? { channel: "hivic_sourced" } : {});
await seed(J_BOOKED, { stage: "piesa_scheduled", booked: true });
await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id) values ($1,'assessment','confirmed',now() + interval '3 days',$2)", [J_BOOKED, OLD]);
await db.query("insert into appointment_proposals (job_id, kind, status) values ($1,'assessment','proposed')", [J_BOOKED]);
for (const [j, source] of [[J_TEST, "qa_test"], [J_OPTOUT, "real"], [J_RETRY, "real"], [J_HELD, "real"], [J_OLDHELD, "real"], [J_OB, "real"]] as const) {
  await seed(j, { stage: "piesa_scheduled", booked: true, source });
  await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id) values ($1,'assessment','confirmed',now() + interval '3 days',$2)", [j, OLD]);
}
await db.query("insert into customer_email_optouts (job_id, opted_out_at) values ($1, now())", [J_OPTOUT]);
await seed(J_NB);
await seed(J_DONE, { stage: "piesa_complete" });
await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source) values ($1,'measured_quote_accepted',$2,'installer_sourced','real')", [J_EARLY, INST]);
await db.query("insert into electrician_nominations (job_id, business_id, nominating_business_id, status) values ($1,$2,$3,'approved')", [J_EARLY, OLD, INST]);
await db.query("insert into assessments (job_id, external_mitti_id) values ($1,'audit-1'), ($2,'audit-2')", [J_FORM, J_FORM2]);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true, assertCustomerDeliveryAllowed: async () => { if (!commsOn) throw new Error("Customer messages are off"); } }));
// The REAL guarded owner sender runs (opt-outs, TEST routing, one reservation per key); only the provider call is stubbed.
const providerCalls: { to: string; subject: string; html: string; text: string; key: string }[] = [];
let providerFails = false;
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async (to: string, subject: string, html: string, text: string, key: string) => { providerCalls.push({ to, subject, html, text, key }); return providerFails ? { outcome: "rejected", status: 422, detail: "bad" } : { outcome: "accepted", id: "re_1", detail: "ok" }; } }));
mock.module("../src/lib/emailsafety.server", () => ({ unsubscribeUrlForJob: async () => "https://example.test/u/1" }));
let failLog: string | null = null;
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { if (failLog === type) { failLog = null; throw new Error(`log blip ${type}`); } await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
  transition: async (job: string, to: string) => { await db.query("update jobs set stage=$2 where id=$1", [job, to]); },
}));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, readInHouseDispatchState: async () => ({ held: new Set(), failed: false }), inHouseDispatchSkip: async () => null }));
const realRec = await import("../src/lib/rec-onboarded.server");
const cand = (b: string, ok: boolean) => ({ business_id: b, name: "x", trading_name: "x", rec_number: "1", onboarding_status: ok ? "approved" : "pending", is_active: true, worker_licences: ["L"], approved_electricians: 1, piesa_rate: null });
mock.module("../src/lib/rec-onboarded.server", () => ({ ...realRec, loadApprovedRecCandidates: async () => [cand(OLD, true), cand(NEW, true), cand(NEW2, true), cand(UNBOARDED, false)] }));
const noticed: string[] = [];
const realNotices = await import("../src/lib/own-job-piesa-notices.server");
mock.module("../src/lib/own-job-piesa-notices.server", () => ({ ...realNotices, sendOwnJobPiesaNotices: async (job: string) => { noticed.push(job); return "ok"; } }));
const emails: { to: string; subject: string; record: unknown; pauseJobId: unknown }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; record: unknown; pauseJobId: unknown }) => { emails.push({ to: p.to, subject: p.subject, record: p.record, pauseJobId: p.pauseJobId }); return { status: "sent" }; } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const realBn = await import("../src/lib/in-house-booking-notices.server");
mock.module("../src/lib/in-house-booking-notices.server", () => ({ ...realBn, deliverOnce: async (_j: string, _k: string, mail: unknown, send: (m: unknown) => Promise<unknown>) => { await send(mail); return true; } }));
let mittiMissing = false;
const moved: { auditId: string; email: string }[] = [];
const realMitti = await import("../src/lib/mitti.server");
mock.module("../src/lib/mitti.server", () => ({ ...realMitti, findMittiUserByEmail: async () => (mittiMissing ? null : "mitti-user"), reassignMittiFormTo: async (p: { auditId: string; email: string }) => { moved.push({ auditId: p.auditId, email: p.email }); } }));

const swap = await import("../src/lib/electrician-swap.server");
const els = await import("../src/lib/own-job-electrician-link.server");
const events = async (job: string, type: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [job, type])).rows;
const active = async (job: string) => (await db.query<{ business_id: string }>("select business_id from job_assignments where job_id=$1 and role='electrician' and active", [job])).rows;
const APPROVED = { oldEmailApproved: true };

describe("installerSwapElectrician", () => {
  test("a swap gives the new electrician an active assignment and nomination, ends the old ones", async () => {
    await swap.installerSwapElectrician(J_TOBOOK, INST, NEW, BOSS, APPROVED);
    expect((await active(J_TOBOOK)).map((r) => r.business_id)).toEqual([NEW]);
    const noms = (await db.query<{ business_id: string; ended_at: string | null }>("select business_id, ended_at from electrician_nominations where job_id=$1", [J_TOBOOK])).rows;
    expect(noms.filter((n) => !n.ended_at).map((n) => n.business_id)).toEqual([NEW]);
    expect(noms.find((n) => n.business_id === OLD)!.ended_at).not.toBeNull();
    expect((await db.query("select 1 from job_assignments where job_id=$1 and business_id=$2 and not active and end_reason like 'reassigned%'", [J_TOBOOK, OLD])).rows).toHaveLength(1);
    expect(noticed).toContain(J_TOBOOK);
  });
  test("the old electrician's link is refused with the moved message", async () => {
    const rows = (await db.query<{ revoked_at: string | null; revoked_reason: string | null }>("select revoked_at, revoked_reason from electrician_job_links where job_id=$1", [J_TOBOOK])).rows;
    expect(rows[0]!.revoked_at).not.toBeNull(); expect(rows[0]!.revoked_reason).toBe("swapped");
    const { hashToken, newToken } = await import("../src/lib/worker-links.core");
    const token = newToken();
    await db.query("update electrician_job_links set token_hash=$2 where job_id=$1", [J_TOBOOK, await hashToken(token)]);
    expect(await els.resolveElectricianLink(token)).toEqual({ ok: false, reason: "This job has moved to another electrician" });
  });
  test("a NEW hand-over event with a fresh 2-business-day due date", async () => {
    const hs = await events(J_TOBOOK, "own_job_piesa_handed");
    expect(hs).toHaveLength(2);
    const last = hs[1]!.details as { due_at: string; electrician_business_id: string; swapped: boolean };
    expect(last.electrician_business_id).toBe(NEW); expect(last.swapped).toBe(true);
    expect(last.due_at).not.toBe("2026-01-01T00:00:00Z");
    expect(Math.abs(Date.parse(last.due_at) - Date.parse(addMelbourneBusinessDays(new Date().toISOString(), 2)))).toBeLessThan(60_000);
  });
  test("exactly one email to the old electrician, through the pause-aware sender", async () => {
    expect(emails).toHaveLength(1);
    expect(emails[0]).toEqual({ to: "old@sparky.test", subject: "You're no longer on 1 Example St, Clayton 3168", record: { businessId: OLD }, pauseJobId: J_TOBOOK });
  });
  test("approved by Jo 3 Nov 2026: the old electrician's email goes by default (no flag passed)", async () => {
    emails.length = 0;
    await swap.installerSwapElectrician(J_REC, INST, NEW, BOSS);
    expect(emails).toHaveLength(1);
    expect((await events(J_REC, "own_job_electrician_swapped"))[0]!.details.old_electrician_email).toBe("sent");
  });
  test("the held path still works when the flag is false: nothing sent, outcome recorded", async () => {
    emails.length = 0;
    await swap.installerSwapElectrician(J_OLDHELD, INST, NEW, BOSS, { oldEmailApproved: false });
    expect(emails).toHaveLength(0);
    expect((await events(J_OLDHELD, "own_job_electrician_swapped"))[0]!.details.old_electrician_email).toBe("not_approved");
  });
  test("a booked safety check is cancelled, the job goes back to 'to book', the new electrician books fresh", async () => {
    await swap.installerSwapElectrician(J_BOOKED, INST, NEW, BOSS, APPROVED);
    expect((await db.query<{ status: string }>("select status from bookings where job_id=$1", [J_BOOKED])).rows.map((r) => r.status)).toEqual(["cancelled"]);
    expect((await db.query<{ stage: string }>("select stage from jobs where id=$1", [J_BOOKED])).rows[0]!.stage).toBe("piesa_and_install_window_pending");
    expect((await db.query("select 1 from job_assignments where job_id=$1 and active and booking_confirmed_at is null and business_id=$2", [J_BOOKED, NEW])).rows).toHaveLength(1);
    expect((await db.query("select 1 from job_assignments where job_id=$1 and booking_confirmed_at is not null", [J_BOOKED])).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>("select status from appointment_proposals where job_id=$1", [J_BOOKED])).rows[0]!.status).toBe("superseded");
    expect((await db.query("select 1 from contact_releases where job_id=$1 and revoked_at is null", [J_BOOKED])).rows).toHaveLength(0);
    expect((await events(J_BOOKED, "own_job_electrician_swapped"))[0]!.details.booking_cancelled).toBe(true);
  });
  test("the Mitti form moves to the new electrician; a failure is an office item, not a failed swap", async () => {
    await swap.installerSwapElectrician(J_FORM, INST, NEW, BOSS, APPROVED);
    expect(moved).toEqual([{ auditId: "audit-1", email: "newnic@x.test" }]);
  });
  test("refused once the safety check is done, and nothing changes", async () => {
    await expect(swap.installerSwapElectrician(J_DONE, INST, NEW, BOSS, APPROVED)).rejects.toThrow("The safety check is done, so the electrician can't change");
    expect((await active(J_DONE)).map((r) => r.business_id)).toEqual([OLD]);
    expect(await events(J_DONE, "own_job_piesa_handed")).toHaveLength(1);
    await db.query("insert into piesa_records (job_id) values ($1)", [J_TOBOOK]);
    await expect(swap.installerSwapElectrician(J_TOBOOK, INST, OLD, BOSS, APPROVED)).rejects.toThrow("The safety check is done");
  });
  test("refused for unlinked, not signed up, and the same electrician", async () => {
    await expect(swap.installerSwapElectrician(J_REC, INST, UNLINKED, BOSS, APPROVED)).rejects.toThrow("That electrician isn't linked to your business");
    await expect(swap.installerSwapElectrician(J_REC, INST, UNBOARDED, BOSS, APPROVED)).rejects.toThrow("That electrician hasn't finished signing up");
    await expect(swap.installerSwapElectrician(J_REC, INST, NEW, BOSS, APPROVED)).rejects.toThrow("That's already the electrician");
  });
  test("another installer's job and an HIV lead are refused", async () => {
    await expect(swap.installerSwapElectrician(J_REC, OTHER_INST, NEW, BOSS, APPROVED)).rejects.toThrow("Only the installer who supplied this job");
    await expect(swap.installerSwapElectrician(J_LEAD, INST, NEW, BOSS, APPROVED)).rejects.toThrow("not your own job");
  });
  test("before the hand-over only the choice changes (no assignment, no event, no text)", async () => {
    noticed.length = 0;
    await swap.installerSwapElectrician(J_EARLY, INST, NEW, BOSS, APPROVED);
    expect((await active(J_EARLY))).toHaveLength(0);
    expect(await events(J_EARLY, "own_job_piesa_handed")).toHaveLength(0);
    expect(noticed).toHaveLength(0);
    expect((await db.query<{ business_id: string }>("select business_id from electrician_nominations where job_id=$1 and ended_at is null", [J_EARLY])).rows.map((r) => r.business_id)).toEqual([NEW]);
  });
  test("swapOptions lists linked, signed-up electricians other than the current one; hidden when done", async () => {
    expect((await swap.swapOptions(J_REC, INST)).options.map((o) => o.businessId)).toEqual([OLD, NEW2]); // J_REC was swapped to NEW above
    expect((await swap.swapOptions(J_DONE, INST)).allowed).toBe(false);
    expect((await swap.swapOptions(J_REC, OTHER_INST)).allowed).toBe(false);
  });

  test("a swap that stops right after the new electrician is added is finished by a retry (one hand-over, one text, one email)", async () => {
    noticed.length = 0; emails.length = 0;
    failLog = "own_job_piesa_handed";
    await expect(swap.installerSwapElectrician(J_RESUME, INST, NEW, BOSS, APPROVED)).rejects.toThrow("log blip");
    expect((await active(J_RESUME)).map((r) => r.business_id)).toEqual([NEW]);
    expect(noticed.filter((j) => j === J_RESUME)).toHaveLength(0);
    await swap.installerSwapElectrician(J_RESUME, INST, NEW, BOSS, APPROVED);
    const hs = (await events(J_RESUME, "own_job_piesa_handed")).filter((e) => e.details.electrician_business_id === NEW);
    expect(hs).toHaveLength(1);
    expect(noticed.filter((j) => j === J_RESUME)).toHaveLength(1);
    expect(emails.filter((e) => e.pauseJobId === J_RESUME)).toHaveLength(1);
    expect((await db.query("select 1 from electrician_job_links where job_id=$1 and revoked_at is null", [J_RESUME])).rows).toHaveLength(0);
    expect(await events(J_RESUME, "own_job_electrician_swapped")).toHaveLength(1);
    // finished: asking again is the normal "already the electrician"
    await expect(swap.installerSwapElectrician(J_RESUME, INST, NEW, BOSS, APPROVED)).rejects.toThrow("That's already the electrician");
  });
  test("a stop later on (after the hand-over) is also finished by a retry, without a second hand-over", async () => {
    const J = id(111);
    await seed(J);
    failLog = "own_job_electrician_swapped";
    await expect(swap.installerSwapElectrician(J, INST, NEW, BOSS, APPROVED)).rejects.toThrow("log blip");
    await swap.installerSwapElectrician(J, INST, NEW, BOSS, APPROVED);
    expect((await events(J, "own_job_piesa_handed")).filter((e) => e.details.electrician_business_id === NEW)).toHaveLength(1);
    expect(await events(J, "own_job_electrician_swapped")).toHaveLength(1);
  });
  test("when the Mitti form can't be moved the swap stands and one office item is logged (even if logging it fails)", async () => {
    mittiMissing = true;
    await swap.installerSwapElectrician(J_FORM2, INST, NEW, BOSS, APPROVED);
    mittiMissing = false;
    expect((await active(J_FORM2)).map((r) => r.business_id)).toEqual([NEW]);
    const ev = await events(J_FORM2, "own_job_swap_form_not_moved");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ electrician_name: "New Sparky", needs_office: true });
    const J = id(112);
    await seed(J); await db.query("insert into assessments (job_id, external_mitti_id) values ($1,'audit-9')", [J]);
    mittiMissing = true; failLog = "own_job_swap_form_not_moved";
    await swap.installerSwapElectrician(J, INST, NEW, BOSS, APPROVED);
    mittiMissing = false;
    expect((await active(J)).map((r) => r.business_id)).toEqual([NEW]);
  });
  test("two people changing it at once leave exactly one electrician", async () => {
    const r = await Promise.allSettled([swap.installerSwapElectrician(J_RACE, INST, NEW, BOSS, APPROVED), swap.installerSwapElectrician(J_RACE, INST, NEW2, BOSS, APPROVED)]);
    expect(await active(J_RACE)).toHaveLength(1);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message)).toContain("Someone else just changed the electrician");
    const winner = (await active(J_RACE))[0]!.business_id;
    expect((await db.query<{ business_id: string }>("select business_id from electrician_nominations where job_id=$1 and ended_at is null", [J_RACE])).rows.map((x) => x.business_id)).toEqual([winner]);
  });
  test("a swap logs its own summary, not 'offered the owner's times first'", async () => {
    const t = (await db.query<{ summary: string }>("select summary from workflow_events where event_type='electrician_chosen_by_installer'")).rows;
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => !x.summary.includes("offered the owner"))).toBe(true);
  });
});

describe("after 'Can't do this one' (final review)", () => {
  const cantDo = async (job: string) => {
    const { hashToken, newToken } = await import("../src/lib/worker-links.core");
    const token = newToken();
    await db.query("update electrician_job_links set token_hash=$2 where job_id=$1", [job, await hashToken(token)]);
    await els.linkCantDo(token, "busy");
  };
  test("the same electrician can be picked again: new assignment, new hand-over event, one link text", async () => {
    const J = id(120);
    await seed(J);
    await cantDo(J);
    expect(await active(J)).toHaveLength(0);
    expect((await db.query("select 1 from electrician_nominations where job_id=$1 and ended_at is null", [J])).rows).toHaveLength(1); // the choice stays open
    const before = (await db.query<{ id: string }>("select id from job_assignments where job_id=$1", [J])).rows.map((r) => r.id);
    const opts = await swap.swapOptions(J, INST);
    expect(opts.allowed).toBe(true);
    expect(opts.current).toBeNull();
    expect(opts.options.map((o) => o.businessId)).toContain(OLD);
    const texts = noticed.filter((x) => x === J).length;
    await swap.installerSwapElectrician(J, INST, OLD, BOSS, APPROVED);
    expect((await active(J)).map((r) => r.business_id)).toEqual([OLD]);
    const now = (await db.query<{ id: string }>("select id from job_assignments where job_id=$1 and active", [J])).rows[0]!.id;
    expect(before).not.toContain(now);
    const hs = await events(J, "own_job_piesa_handed");
    expect(hs).toHaveLength(2);
    expect(hs[1]!.details).toMatchObject({ assignment_id: now, electrician_business_id: OLD });
    expect(noticed.filter((x) => x === J).length - texts).toBe(1);
  });
  test("a different linked electrician can be picked", async () => {
    const J = id(121);
    await seed(J);
    await cantDo(J);
    await swap.installerSwapElectrician(J, INST, NEW, BOSS, APPROVED);
    expect((await active(J)).map((r) => r.business_id)).toEqual([NEW]);
    expect(await events(J, "own_job_piesa_handed")).toHaveLength(2);
  });
  test("link table not applied yet: the swap still completes (done marker, hand-over, old electrician email); no link is made", async () => {
    const J = id(122);
    await seed(J);
    await db.exec("alter table electrician_job_links rename to electrician_job_links_hidden");
    try {
      emails.length = 0;
      await swap.installerSwapElectrician(J, INST, NEW, BOSS, APPROVED);
      expect((await active(J)).map((r) => r.business_id)).toEqual([NEW]);
      expect(await events(J, "own_job_electrician_swapped")).toHaveLength(1);
      expect(await events(J, "own_job_piesa_handed")).toHaveLength(2);
      expect(emails).toHaveLength(1);
      await expect(els.createElectricianLink(J, NEW)).rejects.toThrow(); // so the text is held, never sent
      expect(await els.revokeElectricianLinks(J, "x")).toBe(0);
    } finally { await db.exec("alter table electrician_job_links_hidden rename to electrician_job_links"); }
  });
});

describe("owner email when a swap cancels a booked safety check (message 7)", () => {
  test("a swap of a booked safety check sends exactly one owner email, with the approved wording", async () => {
    providerCalls.length = 0;
    await swap.installerSwapElectrician(J_OB, INST, NEW, BOSS, APPROVED);
    expect(providerCalls).toHaveLength(1);
    const m = providerCalls[0]!;
    expect(m.to).toBe("olive@owner.test");
    expect(m.subject).toBe("Your safety check needs a new time");
    expect(m.text).toContain("Hi Olive,\n\nYour installer has changed the electrician for your safety check (PIESA) at 1 Example St, Clayton 3168, so the time we booked is cancelled.\n\nYour new electrician will call you soon to book a new time. You don't need to do anything.\n\nCheers,\nthe Home Insulation Victoria team");
    expect(m.html).toContain("Your new electrician will call you soon");
    const ev = (await events(J_OB, "own_job_electrician_swapped"))[0]!.details;
    expect(ev.owner_email).toEqual(["sent"]);
    expect((await db.query("select 1 from customer_email_sends where job_id=$1 and purpose='own_job_swap_booking_cancelled' and status='sent'", [J_OB])).rows).toHaveLength(1);
  });
  test("a retry that finishes an interrupted swap still sends the owner email only once", async () => {
    providerCalls.length = 0;
    failLog = "own_job_electrician_swapped";
    await expect(swap.installerSwapElectrician(J_RETRY, INST, NEW, BOSS, APPROVED)).rejects.toThrow("log blip");
    expect(providerCalls).toHaveLength(1);
    await swap.installerSwapElectrician(J_RETRY, INST, NEW, BOSS, APPROVED);
    expect(providerCalls).toHaveLength(1);
  });
  test("a swap with no booking sends no owner email", async () => {
    providerCalls.length = 0;
    await swap.installerSwapElectrician(J_NB, INST, NEW, BOSS, APPROVED);
    expect(providerCalls).toHaveLength(0);
    expect((await events(J_NB, "own_job_electrician_swapped"))[0]!.details.owner_email).toBe("no_booking_cancelled");
  });
  test("a TEST job goes only to the test route, marked", async () => {
    providerCalls.length = 0;
    process.env["HIVIC_COM04_TEST_RECIPIENTS"] = "jolowexo@hotmail.com"; // the non-production boundary: only the TEST inbox is allowed
    await swap.installerSwapElectrician(J_TEST, INST, NEW, BOSS, APPROVED);
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]!.to).toBe("jolowexo@hotmail.com");
    expect(providerCalls[0]!.subject).toBe("[TEST] Your safety check needs a new time");
    expect(providerCalls.some((c) => c.to === "olive@owner.test")).toBe(false);
  });
  test("an opted-out owner is not emailed, and the swap still completes", async () => {
    providerCalls.length = 0;
    await swap.installerSwapElectrician(J_OPTOUT, INST, NEW, BOSS, APPROVED);
    expect(providerCalls).toHaveLength(0);
    expect((await active(J_OPTOUT)).map((r) => r.business_id)).toEqual([NEW]);
    expect((await events(J_OPTOUT, "own_job_electrician_swapped"))[0]!.details.owner_email).toEqual(["blocked — unsubscribed"]);
  });
  test("the held path: with the flag false nothing is sent and the outcome is recorded", async () => {
    providerCalls.length = 0;
    await swap.installerSwapElectrician(J_HELD, INST, NEW, BOSS, { ...APPROVED, ownerEmailApproved: false });
    expect(providerCalls).toHaveLength(0);
    expect((await events(J_HELD, "own_job_electrician_swapped"))[0]!.details.owner_email).toEqual(["not_approved"]);
    expect((await active(J_HELD)).map((r) => r.business_id)).toEqual([NEW]);
  });
});
