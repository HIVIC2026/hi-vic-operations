// Decision 161 (Jo, 24 Oct 2026): the business owner allocates a Ready Check to any staff member and an install day only
// to CII-cleared installers; the Mitti form is handed to that person and the 6:30am text goes to their mobile.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { CREW_CLEARANCE_REASON } from "../src/lib/worker-compliance.core";
import { ALLOCATION_REASON, addInMittiFirst, allocationBlocker, allocationOptions, currentAllocation, dailySendKey, dailyTextRecipient, visitKindOfBooking, visitsForStage, type AllocationCandidate } from "../src/lib/visit-allocation.core";

const TODAY = "2026-10-24";
const cleared: AllocationCandidate = { workerId: "w-deep", name: "Bhavdeep Singh", tradeRole: "installer", email: "deep@example.test", mobile: "0400000001", clearance: { certStatus: "verified", level: "full", expiresOn: "2027-01-01" } };
const unverified: AllocationCandidate = { workerId: "w-man", name: "Manminder Singh", tradeRole: "installer", email: "man@example.test", mobile: "0400000002", clearance: { certStatus: null, level: null, expiresOn: null } };
const expired: AllocationCandidate = { ...cleared, workerId: "w-old", name: "Old Cert", clearance: { certStatus: "verified", level: "full", expiresOn: "2026-10-23" } };
const noLevel: AllocationCandidate = { ...cleared, workerId: "w-nolevel", name: "No Level", clearance: { certStatus: "verified", level: null, expiresOn: null } };
const sparky: AllocationCandidate = { workerId: "w-sparky", name: "Office Admin", tradeRole: "electrician", email: "admin@example.test", mobile: null, clearance: null };
const gone: AllocationCandidate = { ...cleared, workerId: "w-gone", name: "Left", removedAt: "2026-10-01T00:00:00Z" };

describe("eligibility (pure)", () => {
  test("Ready Check: any staff member still on the list, whatever their role or certificate", () => {
    for (const c of [cleared, unverified, expired, noLevel, sparky]) expect(allocationBlocker("ready_check", c, TODAY)).toBeNull();
    expect(allocationBlocker("ready_check", gone, TODAY)).toBe(ALLOCATION_REASON.removed);
  });
  test("Install day: only CII-cleared installers (crewClearance, decision 153), with the reason shown", () => {
    expect(allocationBlocker("install", cleared, TODAY)).toBeNull();
    expect(allocationBlocker("install", unverified, TODAY)).toBe(CREW_CLEARANCE_REASON.unverified);
    expect(allocationBlocker("install", expired, TODAY)).toBe(CREW_CLEARANCE_REASON.expired);
    expect(allocationBlocker("install", noLevel, TODAY)).toBe(CREW_CLEARANCE_REASON.noLevel);
    expect(allocationBlocker("install", sparky, TODAY)).toBe(ALLOCATION_REASON.notInstaller);
    expect(allocationBlocker("install", { ...cleared, clearance: undefined }, TODAY)).toBe(CREW_CLEARANCE_REASON.unverified); // facts not loaded = not cleared
  });
  test("picker list: removed people hidden, allowed first, no-mobile note on allowed people", () => {
    const opts = allocationOptions("install", [sparky, gone, unverified, cleared], TODAY);
    expect(opts.map((o) => [o.name, o.allowed])).toEqual([["Bhavdeep Singh", true], ["Manminder Singh", false], ["Office Admin", false]]);
    const rc = allocationOptions("ready_check", [sparky], TODAY)[0]!;
    expect(rc.allowed).toBe(true);
    expect(rc.note).toBe(ALLOCATION_REASON.noMobile);
  });
  test("which picker each stage shows; which bookings are allocatable", () => {
    expect(visitsForStage("ready_check_scheduled")).toEqual(["ready_check"]);
    expect(visitsForStage("new_enquiry")).toEqual(["ready_check"]);
    expect(visitsForStage("installation_booked")).toEqual(["install"]);
    expect(visitsForStage("measured_estimate_ready")).toEqual([]);
    expect(visitKindOfBooking("ready_check")).toBe("ready_check");
    expect(visitKindOfBooking("installation")).toBe("install");
    expect(visitKindOfBooking("assessment")).toBeNull();
  });
  test("latest visit_allocated event per visit kind wins (append-only history)", () => {
    const ev = (visit: string, worker_id: string, created_at: string) => ({ event_type: "visit_allocated", details: { visit, worker_id, worker_name: worker_id, by: "u", mitti_user_id: "m", audit_id: null, form: "none" }, created_at });
    const events = [ev("ready_check", "a", "2026-10-24T01:00:00Z"), ev("ready_check", "b", "2026-10-24T02:00:00Z"), ev("install", "c", "2026-10-24T03:00:00Z"), { event_type: "other", details: {}, created_at: "2026-10-24T04:00:00Z" }];
    expect(currentAllocation(events, "ready_check")?.worker_id).toBe("b");
    expect(currentAllocation(events, "install")?.worker_id).toBe("c");
    expect(currentAllocation([], "install")).toBeNull();
  });
  test("'Add them in Mitti first' names the email the lookup used", () => {
    expect(addInMittiFirst("Deep", "deep@example.test")).toBe("Deep isn't in Mitti yet as deep@example.test. Add them in Mitti first (Business owner does it in Mitti), then allocate.");
  });
});

describe("6:30am text recipient (pure, decision 161 + 165)", () => {
  const owner = { name: "Reinsulate", phone: "+61400000000" };
  test("allocated person with a mobile gets it; nobody allocated → owner as today", () => {
    expect(dailyTextRecipient({ allocated: { workerId: "w1", name: "Deep", mobile: "+61400000001" }, owner })).toMatchObject({ key: "w:w1", phone: "+61400000001", who: "allocated", note: null });
    expect(dailyTextRecipient({ allocated: null, owner })).toMatchObject({ key: "owner", phone: owner.phone, who: "owner", note: null });
  });
  test("allocated person without a mobile → owner, with the reason noted", () => {
    const r = dailyTextRecipient({ allocated: { workerId: "w1", name: "Deep", mobile: null }, owner });
    expect(r.who).toBe("owner");
    expect(r.phone).toBe(owner.phone);
    expect(r.note).toContain("Deep has no mobile on file");
  });
  test("per-recipient send keys: owner keeps the legacy key, staff get their own; window type stays keyed by day", () => {
    expect(dailySendKey("daily", "biz", "2026-10-24", "owner")).toBe("daily:biz:2026-10-24");
    expect(dailySendKey("daily", "biz", "2026-10-24", "w:w1")).toBe("daily:biz:2026-10-24:w:w1");
    expect(dailySendKey("update", "biz", "2026-10-24", "w:w1", "added:b1:t")).toBe("update:biz:2026-10-24:w:w1:added:b1:t");
    expect(dailySendKey("skip", "biz", "2026-10-24", "w:w1")).toBe("skip:biz:2026-10-24:w:w1");
  });
  test("server groups texts per business + recipient and reads the prior snapshot by the recipient's number", () => {
    const src = readFileSync(new URL("../src/lib/daily-mitti-text.server.ts", import.meta.url), "utf8");
    expect(src).toContain("const gKey = `${biz}|${recipient.key}`");
    expect(src).toContain("allocatedPersonFor(b.job_id, vk)");
    expect(src).toContain('.eq("to_number", g.trade.phone).in("kind", ["daily", "update"])');
    expect(src).toContain('dailySendKey("daily", g.trade.businessId, date, g.recipient.key)');
    expect(src).not.toContain("`daily:${g.trade.businessId}:${date}`");
    const sms = readFileSync(new URL("../src/lib/sms.core.ts", import.meta.url), "utf8");
    expect(sms).toContain('daily_mitti: { kind: "window" }');
  });
});

describe("Mitti hand-over helper (source checks: existing form only, same share + owner calls)", () => {
  const src = readFileSync(new URL("../src/lib/mitti.server.ts", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("export async function reassignMittiFormTo"));
  test("preflights the stored audit, then shares and sets the owner; never creates an audit or claims a create", () => {
    expect(fn).toContain("validateStoredMittiAudit(audit, { storedAuditId: p.auditId, jobNumber: job.job_number, templateId })");
    expect(fn).toContain("await api.shareAudit(p.auditId, p.mittiUserId)");
    expect(fn).toContain("await api.setAuditOwner(p.auditId, p.mittiUserId)");
    expect(fn).not.toContain("createAudit");
    expect(fn).not.toContain("claimMittiCreate");
  });
});

// ---- allocateVisit against real rows (PGlite), Mitti + trade context mocked ----
const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, job_number text, stage text, source text);
CREATE TABLE partner_workers (id uuid primary key, business_id uuid, full_legal_name text, trade_role text, email text, mobile text, removed_at timestamptz, worker_role text);
CREATE TABLE businesses (id uuid primary key, email text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean default false, created_at timestamptz default clock_timestamp());
CREATE TABLE ready_checks (id uuid primary key default gen_random_uuid(), job_id uuid, external_mitti_id text, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, external_source text, external_id text);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, business_id uuid, role text, active boolean);
ALTER TABLE partner_workers ADD COLUMN profile_id uuid;`);
const BIZ = "00000000-0000-0000-0000-0000000000b1", OWNER = "00000000-0000-0000-0000-0000000000c1";
const J_RC = "00000000-0000-0000-0000-000000000001", J_INST = "00000000-0000-0000-0000-000000000002";
const W_DEEP = "00000000-0000-0000-0000-0000000000d1", W_MAN = "00000000-0000-0000-0000-0000000000d2", W_NOMITTI = "00000000-0000-0000-0000-0000000000d3";
await db.query(`INSERT INTO jobs VALUES ($1,'HV-3151','ready_check_scheduled','installer_portal'), ($2,'HV-3152','installation_booked','installer_portal')`, [J_RC, J_INST]);
const W_CREW = "00000000-0000-0000-0000-0000000000d4", W_CREW_NOMITTI = "00000000-0000-0000-0000-0000000000d5", W_LEAD_BIZ = "00000000-0000-0000-0000-0000000000d6";
await db.query(`INSERT INTO businesses VALUES ($1,'office@reinsulate.test')`, [BIZ]);
await db.query(`INSERT INTO partner_workers (id, business_id, full_legal_name, trade_role, email, mobile, removed_at, worker_role) VALUES ($1,$4,'Bhavdeep Singh','installer','deep@example.test','0400 000 001',null,null), ($2,$4,'Manminder Singh','installer','man@example.test','0400 000 002',null,null), ($3,$4,'New Person','installer','new@example.test',null,null,null), ($5,$4,'Cara Crew','installer','cara@example.test',null,null,'crew'), ($6,$4,'Cory Crew','installer','cory@example.test',null,null,'crew'), ($7,$4,'Lena Lead','installer',null,null,null,'lead')`, [W_DEEP, W_MAN, W_NOMITTI, BIZ, W_CREW, W_CREW_NOMITTI, W_LEAD_BIZ]);
await db.query(`INSERT INTO ready_checks (job_id, external_mitti_id) VALUES ($1, 'audit_rc1')`, [J_RC]);
await db.query(`INSERT INTO workflow_events (job_id, event_type, summary, details) VALUES ($1, 'mitti_piisa_audit_created', 'PIISA', '{"audit_id":"audit_piisa1"}')`, [J_INST]);

let boss = true;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const OUTSIDER = "00000000-0000-0000-0000-0000000000e9";
mock.module("../src/lib/trade-view.server", () => ({ requireTradeJob: async (userId: string) => { if (userId === OUTSIDER) throw new Error("This job isn't assigned to you."); return { biz: { id: BIZ, name: "Reinsulate" }, boss, kind: "installer", isTest: false }; } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (jobId: string, actorId: string | null, type: string, summary: string, details: Record<string, unknown>) => { await db.query(`INSERT INTO workflow_events (job_id, actor_id, event_type, summary, details) VALUES ($1,$2,$3,$4,$5)`, [jobId, actorId, type, summary, JSON.stringify(details)]); },
}));
const crewList = () => [
  { workerId: W_DEEP, name: "Bhavdeep Singh", eec: "CII-1", eecVerified: true, cleared: true, clearanceReason: null, level: "full", expiresOn: "2027-06-30" },
  { workerId: W_MAN, name: "Manminder Singh", eec: null, eecVerified: false, cleared: false, clearanceReason: CREW_CLEARANCE_REASON.unverified, level: null, expiresOn: null },
  { workerId: W_NOMITTI, name: "New Person", eec: "CII-9", eecVerified: true, cleared: true, clearanceReason: null, level: "full", expiresOn: "2027-06-30" },
  { workerId: W_CREW, name: "Cara Crew", eec: "CII-4", eecVerified: true, cleared: true, clearanceReason: null, level: "full", expiresOn: "2027-06-30", workerRole: "crew" },
  { workerId: W_CREW_NOMITTI, name: "Cory Crew", eec: "CII-5", eecVerified: true, cleared: true, clearanceReason: null, level: "full", expiresOn: "2027-06-30", workerRole: "crew" },
  { workerId: W_LEAD_BIZ, name: "Lena Lead", eec: "CII-6", eecVerified: true, cleared: true, clearanceReason: null, level: "full", expiresOn: "2027-06-30", workerRole: "lead" },
];
mock.module("../src/lib/piisa-a3.server", () => ({
  crewStaff: async () => crewList(),
  loadCrew: async () => ({ staff: crewList(), selection: null }),
  saveCrewSelection: async (jobId: string, actorId: string, sel: unknown) => { await db.query(`INSERT INTO workflow_events (job_id, actor_id, event_type, summary, details) VALUES ($1,$2,'piisa_crew_selected','crew',$3)`, [jobId, actorId, JSON.stringify({ selection: sel })]); return { needsVerification: [] }; },
}));
const mittiUsers: Record<string, string> = { "deep@example.test": "mu-deep", "man@example.test": "mu-man", "cara@example.test": "mu-cara", "office@reinsulate.test": "mu-office" };
const reassigns: unknown[] = [];
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async () => { throw new Error("no network in tests"); },
  findMittiUserByEmail: async (email: string) => mittiUsers[email.trim().toLowerCase()] ?? null,
  reassignMittiFormTo: async (p: unknown) => { reassigns.push(p); return { auditId: (p as { auditId: string }).auditId }; },
}));
const { allocateVisit, allocatedPersonFor, visitAllocationView, saveCrewWithLead } = await import("../src/lib/visit-allocation.server");

async function events(jobId: string) {
  return (await db.query<{ event_type: string; details: { visit: string; worker_id: string; form: string; mitti_user_id: string | null } }>(`SELECT event_type, details FROM workflow_events WHERE job_id=$1 AND event_type='visit_allocated' ORDER BY created_at`, [jobId])).rows;
}

describe("allocateVisit (server wiring)", () => {
  test("Ready Check to any staff member: event recorded, Mitti form handed to THAT person's Mitti user", async () => {
    const r = await allocateVisit(J_RC, OWNER, "ready_check", W_MAN);
    expect(r).toMatchObject({ ok: true, name: "Manminder Singh", form: "reassigned" });
    const ev = await events(J_RC);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ visit: "ready_check", worker_id: W_MAN, mitti_user_id: "mu-man", form: "reassigned" });
    expect(reassigns).toHaveLength(1);
    expect(reassigns[0]).toMatchObject({ jobId: J_RC, auditId: "audit_rc1", kind: "ready_check", mittiUserId: "mu-man", email: "man@example.test", actorId: OWNER });
    expect(await allocatedPersonFor(J_RC, "ready_check")).toEqual({ workerId: W_MAN, name: "Manminder Singh", mobile: "0400 000 002" });
  });
  test("install day refuses an uncleared installer before any Mitti call; a cleared one gets the PIISA", async () => {
    await expect(allocateVisit(J_INST, OWNER, "install", W_MAN)).rejects.toThrow(CREW_CLEARANCE_REASON.unverified);
    expect(await events(J_INST)).toHaveLength(0);
    const r = await allocateVisit(J_INST, OWNER, "install", W_DEEP);
    expect(r.form).toBe("reassigned");
    expect(reassigns.at(-1)).toMatchObject({ jobId: J_INST, auditId: "audit_piisa1", kind: "install", mittiUserId: "mu-deep" });
    expect((await events(J_INST))[0]!.details).toMatchObject({ visit: "install", worker_id: W_DEEP });
  });
  test("no Mitti user under the business → 'Add them in Mitti first', nothing recorded, no hand-over", async () => {
    const before = reassigns.length;
    await expect(allocateVisit(J_INST, OWNER, "install", W_NOMITTI)).rejects.toThrow("Add them in Mitti first");
    expect(reassigns).toHaveLength(before);
    expect((await events(J_INST)).map((e) => e.details.worker_id)).toEqual([W_DEEP]);
  });
  test("Crew with a Mitti login can take a Ready Check but never the install day; Crew without Mitti is told to add them first", async () => {
    await expect(allocateVisit(J_INST, OWNER, "install", W_CREW)).rejects.toThrow("Crew can't be the install-day Lead");
    const r = await allocateVisit(J_RC, OWNER, "ready_check", W_CREW);
    expect(r).toMatchObject({ ok: true, name: "Cara Crew" });
    expect(reassigns.at(-1)).toMatchObject({ jobId: J_RC, mittiUserId: "mu-cara", email: "cara@example.test" });
    const before = (await events(J_RC)).length;
    await expect(allocateVisit(J_RC, OWNER, "ready_check", W_CREW_NOMITTI)).rejects.toThrow("Add them in Mitti first");
    expect(await events(J_RC)).toHaveLength(before);
  });
  test("a Lead with no email of their own is found by the business email", async () => {
    await allocateVisit(J_INST, OWNER, "install", W_LEAD_BIZ);
    expect(reassigns.at(-1)).toMatchObject({ jobId: J_INST, mittiUserId: "mu-office", email: "office@reinsulate.test" });
  });
  test("latest allocation wins; wrong visit for the stage and non-owners are refused", async () => {
    await allocateVisit(J_RC, OWNER, "ready_check", W_DEEP);
    expect(await allocatedPersonFor(J_RC, "ready_check")).toMatchObject({ workerId: W_DEEP });
    await expect(allocateVisit(J_RC, OWNER, "install", W_DEEP)).rejects.toThrow("isn't at its Install day yet");
    boss = false;
    await expect(allocateVisit(J_RC, OWNER, "ready_check", W_DEEP)).rejects.toThrow("Only the business owner");
    const v = await visitAllocationView(J_RC, OWNER);
    expect(v.canAllocate).toBe(false);
    expect(v.visits[0]).toMatchObject({ kind: "ready_check", current: { workerId: W_DEEP, name: "Bhavdeep Singh" }, hasForm: true, options: [] });
    boss = true;
    const vb = await visitAllocationView(J_INST, OWNER);
    expect(vb.visits[0]!.options.map((o) => [o.name, o.allowed])).toEqual([["Bhavdeep Singh", true], ["Lena Lead", true], ["New Person", true], ["Cara Crew", false], ["Cory Crew", false], ["Manminder Singh", false]]);
  });
});

// Jo 29 Oct 2026: staff (active business members, not the owner) can change the Lead too — only through the crew picker.
describe("saveCrewWithLead: staff can change the Lead", () => {
  const STAFF = "00000000-0000-0000-0000-0000000000c2", ASSIGNEE = "00000000-0000-0000-0000-0000000000c3";
  const NOT_STAFF = "00000000-0000-0000-0000-0000000000d9";
  const crewEvents = async () => (await db.query(`SELECT 1 FROM workflow_events WHERE job_id=$1 AND event_type='piisa_crew_selected'`, [J_INST])).rows.length;
  test("a staff member can make another eligible Lead the Lead (form handed over, crew recorded)", async () => {
    await db.query(`INSERT INTO job_assignments (job_id, user_id, business_id, role, active) VALUES ($1,$2,$3,'installer',true)`, [J_INST, ASSIGNEE, BIZ]);
    boss = false;
    const before = await crewEvents();
    await saveCrewWithLead(J_INST, STAFF, { lead: W_DEEP, additional: [] });
    expect(await allocatedPersonFor(J_INST, "install")).toMatchObject({ workerId: W_DEEP });
    expect(reassigns.at(-1)).toMatchObject({ jobId: J_INST, auditId: "audit_piisa1", kind: "install", mittiUserId: "mu-deep", actorId: STAFF });
    expect(await crewEvents()).toBe(before + 1);
    boss = true;
  });
  test("staff are still refused a Crew person or someone not on the Team; nothing recorded", async () => {
    boss = false;
    const ev = (await events(J_INST)).length, crew = await crewEvents();
    await expect(saveCrewWithLead(J_INST, STAFF, { lead: W_CREW, additional: [] })).rejects.toThrow();
    await expect(saveCrewWithLead(J_INST, STAFF, { lead: NOT_STAFF, additional: [] })).rejects.toThrow();
    await expect(allocateVisit(J_INST, STAFF, "install", W_CREW, undefined, { crewPicker: true })).rejects.toThrow(ALLOCATION_REASON.crew);
    await expect(allocateVisit(J_INST, STAFF, "install", NOT_STAFF, undefined, { crewPicker: true })).rejects.toThrow("That person isn't on your staff list.");
    await expect(allocateVisit(J_INST, STAFF, "install", W_NOMITTI, undefined, { crewPicker: true })).rejects.toThrow("Add them in Mitti first");
    expect((await events(J_INST)).length).toBe(ev);
    expect(await crewEvents()).toBe(crew);
    boss = true;
  });
  test("outside the crew picker, staff still can't allocate", async () => {
    boss = false;
    await expect(allocateVisit(J_INST, STAFF, "install", W_LEAD_BIZ)).rejects.toThrow("Only the business owner can allocate a visit.");
    boss = true;
  });
  test("someone who isn't a member of the business is refused", async () => {
    boss = false;
    const ev = (await events(J_INST)).length, crew = await crewEvents();
    await expect(saveCrewWithLead(J_INST, OUTSIDER, { lead: W_LEAD_BIZ, additional: [] })).rejects.toThrow("This job isn't assigned to you.");
    expect((await events(J_INST)).length).toBe(ev);
    expect(await crewEvents()).toBe(crew);
    boss = true;
  });
});
