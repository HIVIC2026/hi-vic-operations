// New job flow Part 9 Task 9 (Jo 2 Nov 2026): required on file before working (DOB + mobile for everyone; Lead/crew a verified
// CII; electrician licence + REC) and THE ONE Lead Installer lock — 9am email / 5pm lock two calendar days before the
// install's Melbourne day (DST-safe), ignoring completed installs, failing CLOSED on a read error; validateBooking (install
// move) and recordLeadChange refuse with LEAD_LOCKED_MESSAGE after the lock.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import { LEAD_LOCKED_MESSAGE, leadInstallerLock, leadInstallerLocked } from "../src/lib/prestart.core";
import * as lockCore from "../src/lib/lead-installer-lock.core";
import { REQUIRED_ON_FILE_WORDS, requiredOnFileBlockers, type PersonOnFile } from "../src/lib/worker-compliance.core";
import * as workerCompliance from "../src/lib/worker-compliance.core";
import * as leadConfirmCore from "../src/lib/lead-installer-confirm.core";
import * as prestartCore from "../src/lib/prestart.core";
import * as visitAllocationCore from "../src/lib/visit-allocation.core";
import * as inHouseBookingCore from "../src/lib/in-house-booking.core";
import { stableUuid } from "../src/lib/mitti-create-claim.core";
import * as tradeExpiryCore from "../src/lib/trade-expiry.core";
import * as melbourne from "../src/lib/melbourne-time.core";

const person = (p: Partial<PersonOnFile> & { name: string; role: PersonOnFile["role"] }): PersonOnFile => ({ dateOfBirth: true, mobile: "0400000000", ciiVerified: true, licenceRecVerified: true, ...p });

describe("requiredOnFileBlockers (pure)", () => {
  test("crew member with no DOB → '{name}: date of birth missing'; Lead without verified CII → blocked", () => {
    expect(requiredOnFileBlockers([person({ name: "Sam Lee", role: "crew", dateOfBirth: false })])).toEqual(["Sam Lee: date of birth missing"]);
    expect(requiredOnFileBlockers([person({ name: "John Smith", role: "lead", ciiVerified: false })])).toEqual([REQUIRED_ON_FILE_WORDS.cii("John Smith")]);
  });
  test("everyone needs DOB + mobile; the electrician licence + REC; boss / office need no certificate; all on file = nothing", () => {
    expect(requiredOnFileBlockers([person({ name: "Will", role: "electrician", licenceRecVerified: false, mobile: " " })])).toEqual([REQUIRED_ON_FILE_WORDS.mobile("Will"), REQUIRED_ON_FILE_WORDS.licence("Will")]);
    expect(requiredOnFileBlockers([person({ name: "Boss", role: "boss", ciiVerified: false, licenceRecVerified: false }), person({ name: "Office", role: "office", ciiVerified: false, licenceRecVerified: false })])).toEqual([]);
    expect(requiredOnFileBlockers([person({ name: "  ", role: "crew", dateOfBirth: false })])).toEqual(["Unnamed person: date of birth missing"]);
    expect(requiredOnFileBlockers([])).toEqual([]);
  });
});

describe("the ONE Lead Installer lock (prestart.core re-exports lead-installer-lock.core)", () => {
  test("Fri 13 Nov 7:30am install → 9am email Tue 10 Nov, lock 5pm Wed 11 Nov, label 'Wed 11 Nov, 5pm'", () => {
    expect(leadInstallerLock("2026-11-12T20:30:00Z")).toEqual({ emailAt: "2026-11-10T22:00:00.000Z", lockAt: "2026-11-11T06:00:00.000Z", lockLabel: "Wed 11 Nov, 5pm" });
  });
  test("DST: Tue 6 Oct 8am AEDT (the lock day is the first DST weekend) → 9am Sun 4 Oct = 22:00Z Sat, 5pm = 06:00Z", () => {
    expect(leadInstallerLock("2026-10-05T21:00:00Z")).toMatchObject({ emailAt: "2026-10-03T22:00:00.000Z", lockAt: "2026-10-04T06:00:00.000Z", lockLabel: "Sun 4 Oct, 5pm" });
  });
  test("locked from the instant, not a second before; a completed install is never locked; same names everywhere", () => {
    const start = "2026-11-12T20:30:00Z";
    expect(leadInstallerLocked(start, new Date("2026-11-11T05:59:00Z"))).toBe(false);
    expect(leadInstallerLocked(start, new Date("2026-11-11T06:00:00Z"))).toBe(true);
    expect(leadInstallerLocked(start, new Date("2026-11-11T06:00:00Z"), { installCompleted: true })).toBe(false);
    expect(LEAD_LOCKED_MESSAGE).toBe("Locked: ESC has been told. Email us to move this install.");
    expect(prestartCore.leadInstallerLock).toBe(lockCore.leadInstallerLock);
    expect(prestartCore.leadInstallerLocked).toBe(lockCore.leadInstallerLocked);
    expect(prestartCore.LEAD_LOCKED_MESSAGE).toBe(lockCore.LEAD_LOCKED_MESSAGE);
    // Parts 5 and 7 import the names; nobody re-implements the clock.
    for (const f of ["src/lib/next-step-box.core.ts", "src/lib/lead-installer-confirm.core.ts", "src/lib/lead-installer-confirm.server.ts", "src/lib/visit-allocation.core.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/from "\.\/(prestart|lead-installer-lock)\.core"/);
      expect(src, f).not.toMatch(/17 \* 3600|- 7 \* 3600_000/);
    }
  });
});

// ── server: validateBooking (install move) and recordLeadChange after the lock; fail closed; completed installs ignored ──
function transpiled(path: string, deps: Record<string, unknown>) {
  const api: Record<string, unknown> = {};
  new Function("exports", "require", ts.transpile(readFileSync(path, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw new Error(`Unmocked dependency ${p}`); return deps[p]; });
  return api;
}
class WorkflowError extends Error {}
type AnyRow = Record<string, unknown>;
/** A client whose reads of `table` answer `{ error }` (a database read failure), every other table as normal. */
function failingReads(shim: { from: (t: string) => unknown }, table: string) {
  const failed = { data: null, error: { code: "XX000", message: `read failed: ${table}` } };
  const chain: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(failed).then(res) : () => chain) });
  return { from: (t: string) => (t === table ? chain : shim.from(t)) };
}
const THU_8AM = "2026-11-11T21:00:00Z"; // Thu 12 Nov 8:00am AEDT → lock Tue 10 Nov 5pm = 2026-11-10T06:00:00Z
const TUE_1659 = new Date("2026-11-10T05:59:00Z");
const TUE_1701 = new Date("2026-11-10T06:01:00Z");

function lockFixture(now: Date) {
  const rows: Record<string, AnyRow[]> = {
    jobs: [{ id: "j", job_number: "HV-1", stage: "installation_booked", source: "base44", installation_completed_at: null, deleted_at: null }],
    bookings: [{ id: "b1", job_id: "j", kind: "installation", status: "confirmed", scheduled_start: THU_8AM, created_at: "2026-11-01T00:00:00Z" }],
    job_assignments: [{ id: "a1", job_id: "j", role: "installer", active: true, user_id: "u1", business_id: "biz" }],
    businesses: [{ id: "biz", name: "Rapid Insulation", business_type: "eec_installer", onboarding_status: "approved", is_active: true, capabilities: ["installer"], workcover_exempt_declared_at: null }],
    business_credentials: [
      { id: "c1", business_id: "biz", kind: "public_liability_insurance", label: "Public liability", expires_at: "2027-06-30", verification: "verified", amount_insured_aud: "10000000" },
      { id: "c2", business_id: "biz", kind: "workers_comp_insurance", label: "Workers comp", expires_at: "2027-06-30", verification: "verified" },
    ],
    workflow_events: [{ id: "e1", job_id: "j", event_type: "visit_allocated", created_at: "2026-11-01T00:00:00Z", details: { kind: "install", worker_id: "old", name: "Old Lead" } }],
    partner_workers: [], esc_notifications: [],
  };
  const base = memoryPostgrest(rows as never);
  const failing: { table: string | null } = { table: null };
  const shim = { from: (t: string) => (failing.table ? failingReads(base, failing.table) : base).from(t) };
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: shim },
    "./job-facts.server": { jobAdmin: shim },
    "./workflow.server": { WorkflowError, logEvent: async () => {}, getStage: async () => "installation_booked", commercialBlocker: async () => null, paymentGate: async () => ({ cleared: true }), piesaStatus: async () => ({ install_deadline: null }), transition: async () => {}, stageEntryBlockers: async () => [] },
    "./workflow": { installationDateBlocker: () => null, STAGE_LABEL: {} },
    "./install-days.core": { installEndAt: (s: string) => s, installWindowDeadline: () => "2026-12-31", installDayOutsideWindow: () => false, NEW_PIESA_NEEDED: "new PIESA" },
    "./invoice-dates.server": {}, "./autoadvance.server": {},
    "./allocation.server": { clearanceFacts: async () => ({}) }, "./allocation.core": { electricalClearance: () => ({ cleared: true, timingDate: "2026-11-01" }), installationCoordinationBlocker: () => null },
    "./esc.core": { bookingLeadBlocker: () => null, isWithdrawn: () => false },
    "./piesa-owner-confirm.server": { ownerPiesaConfirmationBlockerFor: async () => null },
    "./payments.server": { installDepositBlockerFor: async () => null }, "./job-live.server": { jobDeletedBlocker: async () => null },
    "./in-house-electrician.server": { allocatedWorkerId: async () => null },
    "./worker-compliance.core": workerCompliance, "./trade-expiry.core": tradeExpiryCore, "./melbourne-time.core": melbourne,
    "./lead-installer-confirm.core": leadConfirmCore, "./prestart.core": prestartCore, "./visit-allocation.core": visitAllocationCore,
    "./piisa-a3.core": { leadWorkerId: (sel: { lead?: unknown }) => (typeof sel.lead === "string" ? sel.lead : null) },
    "./people-on-file.server": { requirePeopleOnFileForBooking: async () => {} },
  };
  deps["./install-booking.server"] = transpiled("src/lib/install-booking.server.ts", deps);
  deps["./business-docs.server"] = transpiled("src/lib/business-docs.server.ts", deps);
  const lc = transpiled("src/lib/lead-installer-confirm.server.ts", deps) as { assertLeadInstallerUnlocked: (j: string, c: { newStart?: string; newLeadId?: string }, now?: Date) => Promise<void>; leadInstallerLockState: (j: string, now: Date) => Promise<{ locked: boolean }> };
  // validateBooking takes "now" from the clock: the server check is given this fixture's instant.
  deps["./lead-installer-confirm.server"] = { ...lc, assertLeadInstallerUnlocked: (j: string, c: { newStart?: string; newLeadId?: string }) => lc.assertLeadInstallerUnlocked(j, c, now) };
  const booking = transpiled("src/lib/booking.server.ts", deps) as { validateBooking: (jobId: string, kind: string, start: string, actor: string | null) => Promise<unknown> };
  return { rows, deps, lc, booking, failReads: (table: string) => { failing.table = table; } };
}

describe("validateBooking: moving a booked install after the lock (server)", () => {
  test("Thu 8am install: moved at Tue 17:01 → LEAD_LOCKED_MESSAGE; at Tue 16:59 → allowed; the same start is never a move", async () => {
    const late = lockFixture(TUE_1701);
    await expect(late.booking.validateBooking("j", "installation", "2026-11-12T21:00:00Z", null)).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    await expect(late.booking.validateBooking("j", "installation", THU_8AM, null)).resolves.toEqual({ stage: "installation_booked", target: "installation_booked" });
    const early = lockFixture(TUE_1659);
    await expect(early.booking.validateBooking("j", "installation", "2026-11-12T21:00:00Z", null)).resolves.toEqual({ stage: "installation_booked", target: "installation_booked" });
  });
  test("a completed install is never locked; a booking read error refuses the move (fail closed)", async () => {
    const done = lockFixture(TUE_1701);
    done.rows["jobs"]![0]!["installation_completed_at"] = "2026-11-12T06:00:00Z";
    expect((await done.lc.leadInstallerLockState("j", TUE_1701)).locked).toBe(false);
    await expect(done.booking.validateBooking("j", "installation", "2026-11-12T21:00:00Z", null)).resolves.toBeDefined();
    const broken = lockFixture(TUE_1701);
    broken.failReads("bookings");
    await expect(broken.lc.leadInstallerLockState("j", TUE_1701)).rejects.toThrow(/Could not check the install booking: read failed: bookings/);
    await expect(broken.booking.validateBooking("j", "installation", "2026-11-12T21:00:00Z", null)).rejects.toThrow(/Could not check the install booking/);
    const noJob = lockFixture(TUE_1701);
    noJob.failReads("jobs");
    await expect(noJob.lc.assertLeadInstallerUnlocked("j", { newLeadId: "new" }, TUE_1701)).rejects.toThrow(/Could not check the install booking: read failed: jobs/);
    const noEvents = lockFixture(TUE_1701);
    noEvents.failReads("workflow_events");
    await expect(noEvents.lc.assertLeadInstallerUnlocked("j", { newLeadId: "new" }, TUE_1701)).rejects.toThrow(/Could not check the Lead Installer/);
  });
  test("every lock reader reads the lockable booking (completed ignored, read error thrown), never a page's copy or a swallowed error", () => {
    for (const f of ["src/lib/lead-installer-confirm.server.ts", "src/lib/visit-allocation.server.ts", "src/lib/in-house-booking.server.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("currentLockableInstallBooking(jobId)");
      expect(src, f).not.toContain("currentConfirmedInstallBooking(jobId).catch(() => null)");
    }
    const ib = readFileSync("src/lib/install-booking.server.ts", "utf8");
    expect(ib).toContain("installation_completed_at");
    const bs = readFileSync("src/lib/booking.server.ts", "utf8");
    expect(bs).toContain("assertLeadInstallerUnlocked(jobId, { newStart: move.start })");
  });
});

describe("recordLeadChange after the lock (server)", () => {
  function fixture(now: Date) {
    const f = lockFixture(now);
    const sends: string[] = [];
    f.rows["partner_workers"] = [{ id: "new", business_id: "biz", trade_role: "installer", full_legal_name: "Pat Smith", esc_registered: true, esc_registered_at: "2026-10-01", removed_at: null }];
    Object.assign(f.deps, {
      "./in-house-booking.core": inHouseBookingCore, "./mitti-create-claim.core": { stableUuid },
      "./in-house-suppression.server": { readInHouseDispatchState: async () => ({ held: new Set(["j"]), failed: false }) },
      "./quote-hold.core": { smsQuietReason: () => null }, "./comms.server": { assertCustomerDeliveryAllowed: async () => {} },
      "./partner-email.core": { partnerEmailLayout: () => ({ html: "b", text: "b" }) }, "./owner-email-send.server": { sendGuardedOwnerEmail: async () => "sent" },
      "./sms.server": { sendRealSms: async () => ({ status: "sent" }) }, "./swms.server": { loadSwms: async () => {} }, "./swms-sign-text.server": { textSwmsSignLinks: async () => {} },
      "./trade-view.server": { requireTradeJob: async () => ({ boss: true, kind: "installer", biz: { id: "biz" } }) },
      "./visit-allocation.server": { allocationCandidates: async () => [{ workerId: "new", name: "Pat Smith", mobile: null, tradeRole: "installer", workerRole: "lead", clearance: { certStatus: "verified", level: "full", expiresOn: "2027-12-31" } }] },
      "./payments.server": { jobPaymentView: async () => ({ steps: [] }), installDepositBlockerFor: async () => null }, "./piisa-a3.server": { loadCrew: async () => ({ selection: null }) },
      "./payments.core": { isStepPaid: () => true },
      "./visit-allocation.core": { ...visitAllocationCore, allocationBlocker: () => null },
      "./esc.server": { regenerateEscNotification: async () => { sends.push("robot"); } },
      "./in-house-booking-notices.server": { notifyOfficeLeadChanged: async () => { sends.push("office"); } },
    });
    const api = transpiled("src/lib/in-house-booking.server.ts", f.deps) as { recordLeadChange: (j: string, a: string, o: string | null, n: string, now: Date) => Promise<void> };
    return { ...f, api, sends };
  }
  test("Thu 8am install: a Lead swap at Tue 17:01 → throws LEAD_LOCKED_MESSAGE and records nothing; at Tue 16:59 → allowed", async () => {
    const late = fixture(TUE_1701);
    await expect(late.api.recordLeadChange("j", "actor", "old", "new", TUE_1701)).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    expect(late.rows["workflow_events"]!.filter((e) => e["event_type"] === "in_house_lead_changed")).toHaveLength(0);
    const early = fixture(TUE_1659);
    await expect(early.api.recordLeadChange("j", "actor", "old", "new", TUE_1659)).resolves.toBeUndefined();
    expect(early.rows["workflow_events"]!.filter((e) => e["event_type"] === "in_house_lead_changed")).toHaveLength(1);
  });
  test("a completed install is not locked; a booking read error refuses (fail closed)", async () => {
    const done = fixture(TUE_1701);
    done.rows["jobs"]![0]!["installation_completed_at"] = "2026-11-12T06:00:00Z";
    await expect(done.api.recordLeadChange("j", "actor", "old", "new", TUE_1701)).resolves.toBeUndefined();
    const broken = fixture(TUE_1701);
    broken.failReads("jobs");
    await expect(broken.api.recordLeadChange("j", "actor", "old", "new", TUE_1701)).rejects.toThrow(/read failed: jobs/);
    expect(broken.rows["workflow_events"]!.filter((e) => e["event_type"] === "in_house_lead_changed")).toHaveLength(0);
  });
});
