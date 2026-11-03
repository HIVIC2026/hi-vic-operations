// Part 2 Task 5: the installer swaps the electrician on its own job. Real rows in PGlite; the stage writer, Mitti, the
// booking-time texts and the email sender are stubbed at their seams. The link table and link rules are the real ones.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { addMelbourneBusinessDays } from "../src/lib/melbourne-time.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, electrician_choice text, created_at timestamptz default clock_timestamp());
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
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, external_mitti_id text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), OLD = id(2), NEW = id(3), UNLINKED = id(4), UNBOARDED = id(5), OTHER_INST = id(6);
const UOLD = id(12), UNEW = id(13), BOSS = id(20);
const J_BOOKED = id(101), J_TOBOOK = id(102), J_DONE = id(103), J_REC = id(104), J_EARLY = id(105), J_LEAD = id(106), J_FORM = id(107);
for (const [b, n, e] of [[INST, "Reinsulate", "office@reinsulate.test"], [OLD, "Old Sparky", "old@sparky.test"], [NEW, "New Sparky", "new@sparky.test"], [UNLINKED, "Stranger", null], [UNBOARDED, "Newbie", null], [OTHER_INST, "Other", null]] as const)
  await db.query("insert into businesses values ($1,$2,$2,$3,null,null)", [b, n, e]);
await db.query("insert into partner_workers (business_id, profile_id, full_legal_name, email) values ($1,$2,'Old Sam','oldsam@x.test'), ($3,$4,'New Nic','newnic@x.test')", [OLD, UOLD, NEW, UNEW]);
await db.query("insert into partner_relationships (installer_business_id, electrician_business_id) values ($1,$2), ($1,$3), ($1,$4)", [INST, OLD, NEW, UNBOARDED]);
const seed = async (job: string, o: { stage?: string; channel?: string; booked?: boolean } = {}) => {
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source) values ($1,$2,$3,$4,'real')", [job, o.stage ?? "piesa_and_install_window_pending", INST, o.channel ?? "installer_sourced"]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id, booking_confirmed_at) values ($1,'electrician',$2,$3,$4)", [job, OLD, UOLD, o.booked ? new Date().toISOString() : null]);
  await db.query("insert into electrician_nominations (job_id, business_id, nominating_business_id, status) values ($1,$2,$3,'approved')", [job, OLD, INST]);
  await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'own_job_piesa_handed','handed',$2,true)", [job, JSON.stringify({ key: `own_job_piesa:${job}:first`, due_at: "2026-01-01T00:00:00Z" })]);
  await db.query("insert into electrician_job_links (job_id, electrician_business_id, token_hash, expires_at) values ($1,$2,$3,now() + interval '30 days')", [job, OLD, `hash-${job}`]);
  await db.query("insert into contact_releases (job_id, assignment_id, visit_kind) select $1, id, 'piesa' from job_assignments where job_id=$1", [job]);
};
for (const j of [J_TOBOOK, J_REC, J_LEAD, J_FORM]) await seed(j, j === J_LEAD ? { channel: "hivic_sourced" } : {});
await seed(J_BOOKED, { stage: "piesa_scheduled", booked: true });
await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id) values ($1,'assessment','confirmed',now() + interval '3 days',$2)", [J_BOOKED, OLD]);
await db.query("insert into appointment_proposals (job_id, kind, status) values ($1,'assessment','proposed')", [J_BOOKED]);
await seed(J_DONE, { stage: "piesa_complete" });
await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source) values ($1,'measured_quote_accepted',$2,'installer_sourced','real')", [J_EARLY, INST]);
await db.query("insert into electrician_nominations (job_id, business_id, nominating_business_id, status) values ($1,$2,$3,'approved')", [J_EARLY, OLD, INST]);
await db.query("insert into assessments (job_id, external_mitti_id) values ($1,'audit-1')", [J_FORM]);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
  transition: async (job: string, to: string) => { await db.query("update jobs set stage=$2 where id=$1", [job, to]); },
}));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({ ...realSuppression, readInHouseDispatchState: async () => ({ held: new Set(), failed: false }), inHouseDispatchSkip: async () => null }));
const realRec = await import("../src/lib/rec-onboarded.server");
const cand = (b: string, ok: boolean) => ({ business_id: b, name: "x", trading_name: "x", rec_number: "1", onboarding_status: ok ? "approved" : "pending", is_active: true, worker_licences: ["L"], approved_electricians: 1, piesa_rate: null });
mock.module("../src/lib/rec-onboarded.server", () => ({ ...realRec, loadApprovedRecCandidates: async () => [cand(OLD, true), cand(NEW, true), cand(UNBOARDED, false)] }));
const noticed: string[] = [];
const realNotices = await import("../src/lib/own-job-piesa-notices.server");
mock.module("../src/lib/own-job-piesa-notices.server", () => ({ ...realNotices, sendOwnJobPiesaNotices: async (job: string) => { noticed.push(job); return "ok"; } }));
const emails: { to: string; subject: string; record: unknown; pauseJobId: unknown }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; record: unknown; pauseJobId: unknown }) => { emails.push({ to: p.to, subject: p.subject, record: p.record, pauseJobId: p.pauseJobId }); return { status: "sent" }; } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const realBn = await import("../src/lib/in-house-booking-notices.server");
mock.module("../src/lib/in-house-booking-notices.server", () => ({ ...realBn, deliverOnce: async (_j: string, _k: string, mail: unknown, send: (m: unknown) => Promise<unknown>) => { await send(mail); return true; } }));
const moved: { auditId: string; email: string }[] = [];
const realMitti = await import("../src/lib/mitti.server");
mock.module("../src/lib/mitti.server", () => ({ ...realMitti, findMittiUserByEmail: async () => "mitti-user", reassignMittiFormTo: async (p: { auditId: string; email: string }) => { moved.push({ auditId: p.auditId, email: p.email }); } }));

const swap = await import("../src/lib/electrician-swap.server");
const els = await import("../src/lib/electrician-link.server");
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
  test("the wording is held until approved: no email goes by default", async () => {
    emails.length = 0;
    await swap.installerSwapElectrician(J_REC, INST, NEW, BOSS);
    expect(emails).toHaveLength(0);
    expect((await events(J_REC, "own_job_electrician_swapped"))[0]!.details.old_electrician_email).toBe("not_approved");
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
    expect((await swap.swapOptions(J_REC, INST)).options.map((o) => o.businessId)).toEqual([OLD]) // J_REC was swapped to NEW above;
    expect((await swap.swapOptions(J_DONE, INST)).allowed).toBe(false);
    expect((await swap.swapOptions(J_REC, OTHER_INST)).allowed).toBe(false);
  });
});
