// Jo 5 Nov 2026 (approved): the ONE Electricians list per installer business, on practice Postgres (PGlite). Never the
// live database. A Reinsulate-like fixture: ORLANDO POWERED linked (approved, Usual unticked), no Team electricians and a
// saved usual electrician event "Peter orlando" A63151 — the list shows ORLANDO POWERED as Main, exactly one Main, the one
// Main read every server path uses, and an electrician change saves before anything is sent.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, onboarding_status text, is_active boolean, business_type text, capabilities text[], rec_number text, added_by_installer_business_id uuid);
CREATE TABLE partner_relationships (id uuid primary key default gen_random_uuid(), installer_business_id uuid, electrician_business_id uuid, preferred boolean not null default false, active boolean not null default true, is_primary boolean not null default false, source text, created_by uuid, UNIQUE (installer_business_id, electrician_business_id));
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, trade_role text, approval_status text, full_legal_name text, email text, mobile text, licence_number text, rec_number text, licence_expires_on text, licence_verified_at timestamptz, removed_at timestamptz, created_at timestamptz default clock_timestamp());
CREATE TABLE electrician_rates (id uuid primary key default gen_random_uuid(), business_id uuid, service_type text, rate_inc_gst numeric, status text, effective_from date, effective_to date);
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
const shim = postgrestShim(db);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));
class WorkflowError extends Error {}

const logged: { event: string; details: unknown }[] = [];
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async (_j: string, _a: unknown, event: string, _s: string, details: unknown) => { logged.push({ event, details }); } }));
const s = await import("../src/lib/installer-electricians.server");
const { teamElectricianChoices, changeJobElectrician } = await import("../src/lib/in-house-electrician.server");

const REINSULATE = "00000000-0000-0000-0000-0000000000a1";
const ORLANDO = "00000000-0000-0000-0000-0000000000b1";
const SPARKS = "00000000-0000-0000-0000-0000000000b2";
const TEAM = "00000000-0000-0000-0000-0000000000c1";
const ACTOR = "00000000-0000-0000-0000-0000000000d1";

beforeEach(async () => {
  await db.exec("delete from businesses; delete from partner_relationships; delete from partner_workers; delete from electrician_rates; delete from admin_config_events;");
  await db.query("insert into businesses (id, name, onboarding_status, is_active, business_type, capabilities) values ($1,'Reinsulate','approved',true,'eec_installer','{installer}')", [REINSULATE]);
  await db.query("insert into businesses (id, name, onboarding_status, is_active, business_type, capabilities, rec_number) values ($1,'ORLANDO POWERED','approved',true,'rec','{electrician}','REC1'), ($2,'Bright Sparks','approved',true,'rec','{electrician}','REC2')", [ORLANDO, SPARKS]);
  await db.query("insert into partner_workers (business_id, trade_role, approval_status, full_legal_name, licence_number) values ($1,'electrician','approved','Peter Orlando','A63151'), ($2,'electrician','approved','Sam Spark','B22')", [ORLANDO, SPARKS]);
  await db.query("insert into partner_relationships (installer_business_id, electrician_business_id, preferred, active) values ($1,$2,false,true)", [REINSULATE, ORLANDO]);
  await db.query("insert into admin_config_events (event_type, details) values ('installer_usual_electrician_saved', $1)", [JSON.stringify({ business_id: REINSULATE, electrician: { name: "Peter orlando", licence: "A63151" } })]);
});

describe("Reinsulate-like fixture", () => {
  test("the one list shows ORLANDO POWERED in normal case, Approved, and Main (the usual electrician, same licence)", async () => {
    const list = await s.electriciansForInstaller(REINSULATE);
    expect(list.map((e) => [e.name, e.status, e.main])).toEqual([["Orlando Powered", "approved", true]]);
  });
  test("pickers: Team pickers list the Team only (as on main — no new 'can't be picked' rows); the legacy picker lists ORLANDO as Main", async () => {
    expect(await teamElectricianChoices(REINSULATE)).toEqual([]);
    await db.query("insert into partner_workers (id, business_id, trade_role, approval_status, full_legal_name, email, licence_number, rec_number, licence_expires_on, licence_verified_at) values ($1,$2,'electrician','approved','Tess Team','tess@example.test','C33','REC3','2099-01-01',now())", [TEAM, REINSULATE]);
    expect((await teamElectricianChoices(REINSULATE)).map((e) => [e.name, e.allowed, e.main])).toEqual([["Tess Team", true, false]]);
    await s.setMainInstallerElectrician(ACTOR, REINSULATE, `team:${TEAM}`);
    expect((await teamElectricianChoices(REINSULATE)).map((e) => [e.name, e.main])).toEqual([["Tess Team", true]]); // the default pick
    await s.setMainInstallerElectrician(ACTOR, REINSULATE, `business:${ORLANDO}`);
    const legacy = await s.linkedChoicesForPicker(REINSULATE);
    expect(legacy).toEqual([{ businessId: ORLANDO, primary: true, name: "Orlando Powered", status: "Already signed up ✓" }]);
  });
  test("Add electrician offers approved businesses not on the list; Remove takes them off", async () => {
    expect((await s.electricianBusinessesToAdd(REINSULATE)).map((o) => o.id)).toEqual([SPARKS]);
    await s.addInstallerElectrician(ACTOR, REINSULATE, SPARKS);
    expect((await s.electriciansForInstaller(REINSULATE)).map((e) => e.businessId).sort()).toEqual([ORLANDO, SPARKS].sort());
    await s.removeInstallerElectrician(ACTOR, REINSULATE, SPARKS);
    expect((await s.electriciansForInstaller(REINSULATE)).map((e) => e.businessId)).toEqual([ORLANDO]);
  });
  test("exactly one Main, whichever is ticked; the legacy marker follows it", async () => {
    await s.addInstallerElectrician(ACTOR, REINSULATE, SPARKS);
    await db.query("insert into partner_workers (id, business_id, trade_role, approval_status, full_legal_name, licence_number, rec_number, licence_expires_on, licence_verified_at) values ($1,$2,'electrician','approved','Tess Team','C33','REC3','2099-01-01',now())", [TEAM, REINSULATE]);
    for (const key of [`business:${SPARKS}`, `team:${TEAM}`, `business:${ORLANDO}`]) {
      await s.setMainInstallerElectrician(ACTOR, REINSULATE, key);
      const list = await s.electriciansForInstaller(REINSULATE);
      expect(list.filter((e) => e.main).map((e) => e.key)).toEqual([key]);
      const primary = (await db.query<{ electrician_business_id: string }>("select electrician_business_id from partner_relationships where installer_business_id=$1 and is_primary", [REINSULATE])).rows.map((r) => r.electrician_business_id);
      expect(primary).toEqual(key.startsWith("business:") ? [key.slice(9)] : []);
    }
    await expect(s.setMainInstallerElectrician(ACTOR, REINSULATE, "business:00000000-0000-0000-0000-0000000000ff")).rejects.toThrow("isn't on your list");
  });
});

describe("readMainElectrician: the ONE read every old usual-electrician path now uses", () => {
  test("never ticked: exactly the old saved usual electrician (nothing changes for them)", async () => {
    const m = await s.readMainElectrician(REINSULATE);
    expect([m.ticked, m.electrician]).toEqual([false, { name: "Peter orlando", licence: "A63151" }]);
  });
  test("ticked a linked business: that business, by its approved electrician's licence; the revision is the tick", async () => {
    await s.addInstallerElectrician(ACTOR, REINSULATE, SPARKS);
    await s.setMainInstallerElectrician(ACTOR, REINSULATE, `business:${SPARKS}`);
    const m = await s.readMainElectrician(REINSULATE);
    expect([m.ticked, m.electrician, m.electricianBusinessId, m.workerId]).toEqual([true, { name: "Bright Sparks", licence: "B22" }, SPARKS, null]);
    const tick = (await db.query<{ id: string }>("select id from admin_config_events where event_type='installer_main_electrician_set' order by created_at desc limit 1")).rows[0]!.id;
    expect(m.revision).toBe(tick);
  });
  test("ticked a Team person: that person (name, licence, email)", async () => {
    await db.query("insert into partner_workers (id, business_id, trade_role, approval_status, full_legal_name, email, licence_number, rec_number, licence_expires_on, licence_verified_at) values ($1,$2,'electrician','approved','Tess Team','tess@example.test','C33','REC3','2099-01-01',now())", [TEAM, REINSULATE]);
    await s.setMainInstallerElectrician(ACTOR, REINSULATE, `team:${TEAM}`);
    const m = await s.readMainElectrician(REINSULATE);
    expect([m.electrician, m.workerId, m.electricianBusinessId]).toEqual([{ name: "Tess Team", licence: "C33", email: "tess@example.test" }, TEAM, null]);
  });
  test("the office Partners board names the real Main — Team or linked — and the never-ticked licence match", async () => {
    const OTHER_INSTALLER = "00000000-0000-0000-0000-0000000000a2";
    await db.query("insert into businesses (id, name, onboarding_status, is_active) values ($1,'Second Installer','approved',true)", [OTHER_INSTALLER]);
    await db.query("insert into partner_workers (id, business_id, trade_role, approval_status, full_legal_name, email, licence_number, rec_number, licence_expires_on, licence_verified_at) values ($1,$2,'electrician','approved','Tess Team','tess@example.test','C33','REC3','2099-01-01',now())", [TEAM, OTHER_INSTALLER]);
    expect([...(await s.mainElectricianNamesFor([REINSULATE, OTHER_INSTALLER])).entries()]).toEqual([[REINSULATE, "Orlando Powered"]]);
    await s.setMainInstallerElectrician(ACTOR, OTHER_INSTALLER, `team:${TEAM}`);
    expect((await s.mainElectricianNamesFor([REINSULATE, OTHER_INSTALLER])).get(OTHER_INSTALLER)).toBe("Tess Team");
  });
  test("adding an electrician makes an active, preferred link (as the old Add did)", async () => {
    await s.addInstallerElectrician(ACTOR, REINSULATE, SPARKS);
    const r = (await db.query<{ preferred: boolean; active: boolean }>("select preferred, active from partner_relationships where electrician_business_id=$1", [SPARKS])).rows[0];
    expect(r).toEqual({ preferred: true, active: true });
  });
});

describe("changing the job's electrician (server wiring)", () => {
  const JOB = "00000000-0000-0000-0000-0000000000e1";
  const spies = (o: { done?: boolean; booked?: boolean; mittiFails?: boolean }) => {
    const calls: string[] = [];
    const over = {
      piesaDone: async () => !!o.done,
      prepare: (async () => { calls.push("checks"); return { worker: { full_legal_name: "Tess Team" }, email: "t@example.test", mittiUserId: "m1" }; }) as never,
      bookWithPerson: async () => { calls.push("person + time saved together"); return o.booked === false ? { ok: false as const, blockers: ["That time can't be booked"] } : { ok: true as const }; },
      allocateOnly: async () => { calls.push("person only"); },
      forms: (async () => ({ assessment: null, rectification: null })) as never,
      after: (async () => { calls.push("job-link text + Mitti form"); if (o.mittiFails) throw new Error("Mitti is down"); }) as never,
      afterFailed: async (_j: string, _u: string, _w: string, m: string) => { calls.push(`Needs me: ${m}`); },
      afterOk: async () => { calls.push("Needs me cleared"); },
    };
    return { calls, over };
  };
  test("before the safety check, with a time: one save for person + time, then the text and the form", async () => {
    const { calls, over } = spies({});
    expect(await changeJobElectrician(ACTOR, { jobId: JOB, workerId: TEAM, start: "2026-11-10T09:00:00+11:00" }, over)).toEqual({ ok: true, warnings: [] });
    expect(calls).toEqual(["checks", "person + time saved together", "job-link text + Mitti form", "Needs me cleared"]);
  });
  test("the Mitti hand-over fails after the save: on Needs me and a warning with the success", async () => {
    const { calls, over } = spies({ mittiFails: true });
    const r = await changeJobElectrician(ACTOR, { jobId: JOB, workerId: TEAM, start: "2026-11-10T09:00:00+11:00" }, over);
    expect(r.ok && r.warnings?.length).toBe(1);
    expect(calls).toEqual(["checks", "person + time saved together", "job-link text + Mitti form", "Needs me: Mitti is down"]);
  });
  test("the real failure record is the existing in-house form failure row (needs_office, its own work id)", async () => {
    logged.length = 0;
    const { over } = spies({ mittiFails: true });
    const { afterFailed: _drop, ...rest } = over;
    await changeJobElectrician(ACTOR, { jobId: JOB, workerId: TEAM, start: "2026-11-10T09:00:00+11:00" }, rest as never);
    expect(logged.map((l) => l.event)).toEqual(["in_house_form_sync_failed"]);
    expect(logged[0]!.details).toMatchObject({ needs_office: true, work_id: `electrician-handover:${JOB}`, worker_id: TEAM });
  });
  test("after the safety check: refused, nothing saved or sent", async () => {
    const { calls, over } = spies({ done: true });
    const r = await changeJobElectrician(ACTOR, { jobId: JOB, workerId: TEAM, start: "2026-11-10T09:00:00+11:00" }, over);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("the time save fails: the old electrician stays (no separate person save) and no text is sent", async () => {
    const { calls, over } = spies({ booked: false });
    const r = await changeJobElectrician(ACTOR, { jobId: JOB, workerId: TEAM, start: "2026-11-10T09:00:00+11:00" }, over);
    expect(r).toEqual({ ok: false, blockers: ["That time can't be booked"] });
    expect(calls).toEqual(["checks", "person + time saved together"]);
  });
});
