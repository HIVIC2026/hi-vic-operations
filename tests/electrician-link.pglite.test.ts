// Part 2 Task 3: the electrician's no-login link on real rows (PGlite). confirmBooking is stubbed at its seam (it writes the
// booking, marks the assignment booked and moves the stage like the real one); everything else is the real code.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text);
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address, 'Sam Owner'::text AS owner_name, '0400000000'::text AS owner_phone FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, mobile text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp(), ended_at timestamptz, end_reason text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, business_id uuid, contractor_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
CREATE TABLE contact_releases (id uuid primary key default gen_random_uuid(), job_id uuid, assignment_id uuid, visit_kind text, released_by uuid, owner_notice text, trade_notice text, revoked_at timestamptz, UNIQUE (assignment_id, visit_kind));
CREATE TABLE electrician_job_links (id uuid primary key default gen_random_uuid(), job_id uuid, electrician_business_id uuid, token_hash text unique, created_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz, revoked_reason text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), ELEC2 = id(3), U1 = id(11), U2 = id(12);
const J_BOOK = id(101), J_CANT = id(102), J_MOVED = id(103);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test','0300000000',null), ($2,'Sparky Co','Sparky Co',null,'0411111111',null), ($3,'Volt Co','Volt Co',null,'0422222222',null)`, [INST, ELEC, ELEC2]);
await db.query(`insert into partner_workers (business_id, profile_id, full_legal_name, mobile) values ($1,$2,'Sparky Sam','0411111111'), ($3,$4,'Volt Vic','0422222222')`, [ELEC, U1, ELEC2, U2]);
for (const j of [J_BOOK, J_CANT, J_MOVED]) {
  await db.query("insert into jobs values ($1,'piesa_and_install_window_pending',null,$2,'installer_sourced','real')", [j, INST]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
  await db.query("insert into workflow_events (job_id, event_type, summary, details) values ($1,'own_job_piesa_handed','handed','{}')", [j]);
}
await db.query("insert into appointment_proposals (job_id, kind, status) values ($1,'assessment','proposed'), ($1,'assessment','accepted'), ($1,'installation','proposed')", [J_BOOK]);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const realBooking = await import("../src/lib/booking.server");
mock.module("../src/lib/booking.server", () => ({
  ...realBooking,
  confirmBooking: async (job: string, kind: string, start: string, actor: string) => {
    const a = (await db.query<{ id: string; business_id: string }>("select id, business_id from job_assignments where job_id=$1 and role='electrician' and active", [job])).rows[0]!;
    await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id, contractor_id) values ($1,$2,'confirmed',$3,$4,$5)", [job, kind, start, a.business_id, actor]);
    await db.query("update job_assignments set booking_confirmed_at=now() where id=$1", [a.id]);
    await db.query("update jobs set stage='piesa_scheduled' where id=$1", [job]);
  },
}));
const ownerNotices: string[] = [];
const realInHouse = await import("../src/lib/in-house-booking.server");
mock.module("../src/lib/in-house-booking.server", () => ({ ...realInHouse, notifyOwnerBooked: async (job: string, kind: string) => { ownerNotices.push(`${job}:${kind}`); return "sent"; } }));
const officeEmails: { to: string; subject: string; record: unknown }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; record: unknown }) => { officeEmails.push({ to: p.to, subject: p.subject, record: p.record }); return { status: "sent" }; } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const realBn = await import("../src/lib/in-house-booking-notices.server");
mock.module("../src/lib/in-house-booking-notices.server", () => ({ ...realBn, deliverOnce: async (_j: string, _k: string, mail: unknown, send: (m: unknown) => Promise<unknown>) => { await send(mail); return true; } }));

const els = await import("../src/lib/electrician-link.server");
const core = await import("../src/lib/electrician-link.core");
const tokenFor = async (job: string, biz = ELEC) => new URL((await els.createElectricianJobLink(job, biz)).url, "https://x.test").pathname.replace("/e/", "");
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("round trip", () => {
  test("a fresh link resolves to the book step", async () => {
    const t = await tokenFor(J_BOOK);
    expect(await els.resolveElectricianLink(t)).toEqual({ ok: true, jobId: J_BOOK, electricianBusinessId: ELEC, step: "book_piesa" });
  });
  test("only the hash is stored", async () => {
    const t = await tokenFor(J_BOOK);
    const rows = (await db.query<{ token_hash: string }>("select token_hash from electrician_job_links")).rows;
    expect(rows.some((r) => r.token_hash === t)).toBe(false);
  });
  test("expired is refused", async () => {
    const t = await tokenFor(J_BOOK);
    expect(await els.resolveElectricianLink(t, new Date(Date.now() + 31 * 86_400_000))).toEqual({ ok: false, reason: core.LINK_EXPIRED });
  });
  test("a swapped electrician's link is refused as moved", async () => {
    const t = await tokenFor(J_MOVED);
    await els.revokeElectricianLinks(J_MOVED, "reassigned");
    expect(await els.resolveElectricianLink(t)).toEqual({ ok: false, reason: "This job has moved to another electrician" });
  });
  test("a link whose electrician is no longer the active assignee is refused", async () => {
    const t = await tokenFor(J_MOVED);
    await db.query("update job_assignments set active=false where job_id=$1", [J_MOVED]);
    const r = await els.resolveElectricianLink(t);
    expect(r.ok).toBe(false);
    await db.query("update job_assignments set active=true where job_id=$1", [J_MOVED]);
  });
  test("junk token", async () => expect(await els.resolveElectricianLink("nope")).toMatchObject({ ok: false }));
});

describe("book", () => {
  test("a past time and a time over 30 days after paying are refused", async () => {
    const t = await tokenFor(J_BOOK);
    await expect(els.linkBookPiesa(t, soon(-1))).rejects.toThrow("already passed");
    await expect(els.linkBookPiesa(t, soon(31))).rejects.toThrow("more than 30 days");
    expect((await db.query("select * from bookings where job_id=$1", [J_BOOK])).rows).toHaveLength(0);
  });
  test("booking writes an assessment booking, moves the stage, supersedes open proposed times, tells the owner once", async () => {
    const t = await tokenFor(J_BOOK);
    await els.linkBookPiesa(t, soon(10));
    const b = (await db.query<{ kind: string; status: string }>("select kind, status from bookings where job_id=$1", [J_BOOK])).rows;
    expect(b).toEqual([{ kind: "assessment", status: "confirmed" }]);
    expect((await db.query<{ stage: string }>("select stage from jobs where id=$1", [J_BOOK])).rows[0]!.stage).toBe("piesa_scheduled");
    expect(ownerNotices).toEqual([`${J_BOOK}:piesa`]);
    const p = (await db.query<{ kind: string; status: string }>("select kind, status from appointment_proposals where job_id=$1 order by kind, status", [J_BOOK])).rows;
    expect(p).toEqual([{ kind: "assessment", status: "accepted" }, { kind: "assessment", status: "superseded" }, { kind: "installation", status: "proposed" }]);
    expect(await els.resolveElectricianLink(t)).toMatchObject({ ok: true, step: "do_piesa_in_mitti" });
    await expect(els.linkBookPiesa(t, soon(11))).rejects.toThrow("already booked");
  });
});

describe("can't do this one", () => {
  test("ends the assignment, revokes the link, logs it, emails the office once (held wording: not sent)", async () => {
    const t = await tokenFor(J_CANT);
    await expect(els.linkCantDo(t, "other", "  ")).rejects.toThrow("Tell us why");
    const r = await els.linkCantDo(t, "busy");
    expect(r.officeEmail).toBe("not_approved"); // wording held until Jo approves
    expect((await db.query<{ active: boolean }>("select active from job_assignments where job_id=$1", [J_CANT])).rows[0]!.active).toBe(false);
    expect((await db.query<{ revoked_reason: string }>("select revoked_reason from electrician_job_links where job_id=$1 and revoked_at is not null", [J_CANT])).rows[0]!.revoked_reason).toBe("cant_do");
    const ev = (await db.query<{ details: { reason: string } }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_handed_back'", [J_CANT])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details.reason).toBe("busy");
    expect(await els.resolveElectricianLink(t)).toEqual({ ok: false, reason: "This job has moved to another electrician" });
    await expect(els.linkCantDo(t, "busy")).rejects.toThrow();
  });
  test("once the wording is approved the office email goes (recorded against the installer)", async () => {
    const { emailInstallerOffice } = await import("../src/lib/own-job-piesa-notices.server");
    const out = await emailInstallerOffice({ jobId: J_CANT, businessId: INST, key: "k1", subject: "s", text: "t", jobUrl: "https://x/field/j", approved: true });
    expect(out.status).toBe("sent");
    expect(officeEmails).toHaveLength(1);
    expect(officeEmails[0]!.record).toEqual({ businessId: INST });
  });
});
