// New job flow, Part 9, Task 10 (Jo 2 Nov 2026, answer 21): the install can be booked before the upgrades day (warning
// only, deposit still first); the GO check needs the Part C + certificate; no installer pay without a GO. Own file: it
// mocks the booking path's server modules for the whole process (the REAL validateBooking runs over fakes).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { electricalClearance, installationCoordination, installationCoordinationBlocker, UPGRADES_NOT_DONE_WARNING, type ClearanceFacts } from "../src/lib/allocation.core";
import { NO_GO_FOR_INSTALL, tradePayoutBlockers, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { INSTALL_DEPOSIT_BLOCKER } from "../src/lib/payments.core";
import { installWindowDeadline } from "../src/lib/install-days.core";

// ---------- pure: the clearance → warn / block ----------
// The official PIESA date = today, so the 30-day window and the 24h booking lead hold whenever this file runs.
const TODAY = new Date().toISOString().slice(0, 10);
const base: ClearanceFacts = { piesaOutcome: "fail", piesaCompletedAt: TODAY, rectificationRequired: true, rectificationQuoteAccepted: true, rectificationCompletedAt: null, sectionCSignedAt: null };

describe("installationCoordination: upgrades still to come = a warning, every other reason still blocks", () => {
  test("cleared → nothing", () => {
    expect(installationCoordination(electricalClearance({ ...base, piesaOutcome: "pass", rectificationRequired: false }))).toEqual({ block: null, warn: null });
  });
  test("upgrades not done yet (quote accepted or partner-billed) → the warning, no block", () => {
    expect(installationCoordination(electricalClearance(base))).toEqual({ block: null, warn: UPGRADES_NOT_DONE_WARNING });
    expect(installationCoordination(electricalClearance({ ...base, rectificationCompletedAt: "2026-11-10" }))).toEqual({ block: null, warn: UPGRADES_NOT_DONE_WARNING });
    expect(installationCoordination(electricalClearance({ ...base, rectificationQuoteAccepted: false, partnerBilledRectification: true }))).toEqual({ block: null, warn: UPGRADES_NOT_DONE_WARNING });
    expect(UPGRADES_NOT_DONE_WARNING).toBe("Electrical upgrades aren't done yet. The install can't start until the Part C and certificate are in.");
  });
  test("PIESA not done / did not pass / fixes quote not accepted → still a block", () => {
    const block = (f: ClearanceFacts) => installationCoordination(electricalClearance(f));
    expect(block({ ...base, piesaCompletedAt: null })).toEqual({ block: "Installation cannot be arranged yet: PIESA not completed and signed yet.", warn: null });
    expect(block({ ...base, rectificationRequired: false })).toEqual({ block: "Installation cannot be arranged yet: PIESA did not pass.", warn: null });
    // Main's Part 3 (Jo 2 Nov 2026): the electrician bills the upgrades on every job — no Home Insulation Victoria upgrades
    // quote is needed, so "quote not accepted" is no longer a block: the upgrades are simply outstanding (the warning).
    expect(block({ ...base, rectificationQuoteAccepted: false })).toEqual({ block: null, warn: UPGRADES_NOT_DONE_WARNING });
    // On-site-only (electrician at the start of the install day): main's Part 3 clears it on the PIESA alone (no quote, no payment).
    expect(block({ ...base, onsiteStartOnly: true })).toEqual({ block: null, warn: null });
  });
  test("the old hard blocker is unchanged for its remaining callers", () => {
    expect(installationCoordinationBlocker(electricalClearance(base))).toBe("Installation cannot be arranged yet: Electrical upgrades not completed yet.");
  });
});

// ---------- pure: no installer pay without a GO ----------
const ok: TradePayoutFacts = { piesa: { mittiForm: true, completed: true, evidence: [] }, fixes: { sameVisitOnPiesa: false, outcome: "done", detail: null }, install: { formCompleted: true, evidence: [], go: true } };
describe("tradePayoutBlockers: install pay needs the GO check passed for the booked start", () => {
  test("complete form + evidence but the last check was DON'T START → held", () => {
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: true, evidence: [], go: false } })).toEqual([NO_GO_FOR_INSTALL]);
    expect(NO_GO_FOR_INSTALL).toBe("No GO for this install");
  });
  test("no check recorded for the booked start (null) → held, fails closed", () => {
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: true, evidence: [], go: null } })).toEqual([NO_GO_FOR_INSTALL]);
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: true, evidence: [] } })).toEqual([NO_GO_FOR_INSTALL]);
  });
  test("GO → clear; the GO line comes after the form lines", () => {
    expect(tradePayoutBlockers("installation", ok)).toEqual([]);
    expect(tradePayoutBlockers("installation", { ...ok, install: { formCompleted: false, evidence: [], go: false } })).toEqual(["Mitti install day form (A5) not marked Complete", NO_GO_FOR_INSTALL]);
  });
  test("safety check and fixes payouts are untouched by the GO", () => {
    expect(tradePayoutBlockers("assessment", { ...ok, install: { formCompleted: true, evidence: [], go: false } })).toEqual([]);
    expect(tradePayoutBlockers("rectification", { ...ok, install: { formCompleted: true, evidence: [], go: false } })).toEqual([]);
  });
});

// ---------- pure: the GO check needs the Part C + the certificate ----------
const START = "2026-11-19T21:00:00Z"; // Fri 20 Nov 8am Melbourne
const D = 24 * 3600_000;
const sentAt = new Date(Date.parse(START) - 3 * D).toISOString();
const goOk: PrestartFacts = {
  start: START, clearance: { cleared: true, blocker: null }, deadline: "2026-12-02", esc: { status: "sent", sent_at: sentAt, submission_reference: "REF-1", scheduled_start: START },
  lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Lee" }, consentBlockers: [], piesaCompletedAt: "2026-11-02",
  installDepositBlocker: null, piesaCopyBlockers: [], certificate: "ticked",
};
// Join (4 Nov 2026, ruling 4): the certificate gate is main's Part 3 fact (certificate / certificateWhy), not a second coesBlocker.
const CERT_UNCHECKED = { certificate: "unchecked" as const, certificateWhy: "not checked yet" };
describe("GO check: booked before the upgrades day, Part C or certificate missing at 2pm → DON'T START", () => {
  test("Part C not in → the electrical clearance line", () => {
    const c = electricalClearance(base);
    expect(prestartFailures({ ...goOk, clearance: { cleared: c.cleared, blocker: c.blocker } })).toEqual(["Electrical clearance is not valid: Electrical upgrades not completed yet."]);
    const c2 = electricalClearance({ ...base, rectificationCompletedAt: "2026-11-10" });
    expect(prestartFailures({ ...goOk, clearance: { cleared: c2.cleared, blocker: c2.blocker } })).toEqual(["Electrical clearance is not valid: Section C not completed and signed yet."]);
  });
  test("Part C in but the certificate not ticked → the certificate line", () => {
    expect(prestartFailures({ ...goOk, ...CERT_UNCHECKED })).toEqual(["Check electrical certificate — not checked yet"]);
    expect(prestartFailures({ ...goOk, certificate: "missing" })).toEqual(["Certificate of Electrical Safety not in yet"]);
  });
  test("both in → that line gone (GO)", () => {
    expect(prestartFailures(goOk)).toEqual([]);
  });
  test("no GO line ever mentions a deposit due time", () => {
    const lines = prestartFailures({ ...goOk, clearance: { cleared: false, blocker: "Section C not completed and signed yet." }, installDepositBlocker: INSTALL_DEPOSIT_BLOCKER, ...CERT_UNCHECKED });
    for (const l of lines) expect(l).not.toMatch(/2pm|12pm|by the day before|due time/i);
  });
});

// ---------- server: validateBooking("installation") warns instead of throwing; the deposit blocker still runs first ----------
const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1";
const INSTALL_START = new Date(Date.now() + 5 * D).toISOString(); // inside 30 days of the PIESA, more than 24h ahead
const OUTSIDE_START = new Date(Date.now() + 35 * D).toISOString();
const DEADLINE = installWindowDeadline(TODAY);
class WorkflowError extends Error {}
const state = { stage: "installation_scheduling", clearance: base as ClearanceFacts, deposit: null as string | null, ownerConfirm: null as string | null, entryBlockers: [] as string[] };

mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const row = table === "job_assignments" ? { id: "a1", user_id: "u1", business_id: INST, businesses: { business_type: "eec_installer", onboarding_status: "approved", is_active: true, capabilities: ["installer"] } } : null;
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "is", "order", "limit", "update", "insert"]) q[m] = () => q;
      q["maybeSingle"] = async () => ({ data: row, error: null });
      q["single"] = async () => ({ data: row, error: null });
      q["then"] = (r: (v: unknown) => unknown) => r({ data: row ? [row] : [], error: null });
      return q;
    },
    rpc: async () => ({ data: false, error: null }),
  },
}));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  getStage: async () => state.stage,
  piesaStatus: async () => ({ piesa_expired: false, install_deadline: null, piesa_date: TODAY, piesa_outcome: "fail" }),
  commercialBlocker: async () => null,
  paymentGate: async () => ({ cleared: true, blocker: null }),
  stageEntryBlockers: async () => state.entryBlockers,
  logEvent: async () => {},
  transition: async () => {},
  READY_CHECK_BOOKING_RECORD_BLOCKER: "rc",
}));
mock.module("../src/lib/allocation.server", () => ({ clearanceFacts: async () => state.clearance }));
mock.module("../src/lib/payments.server", () => ({ installDepositBlockerFor: async () => state.deposit, fixesPaymentBlockerFor: async () => null }));
mock.module("../src/lib/piesa-owner-confirm.server", () => ({ ownerPiesaConfirmationBlockerFor: async () => state.ownerConfirm }));
mock.module("../src/lib/job-live.server", () => ({ jobDeletedBlocker: async () => null }));
mock.module("../src/lib/invoice-dates.server", () => ({ setInstallDueDate: async () => {} }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => {} }));
// Joined branch (4 Nov 2026): Task 8's insurance gate, Task 9's people-on-file + Lead lock run on every booking — clear here.
mock.module("../src/lib/business-docs.server", () => ({ requireBusinessDocs: async () => {}, businessDocsBlockerFor: async () => null }));
mock.module("../src/lib/people-on-file.server", () => ({ requirePeopleOnFileForBooking: async () => {}, requiredOnFileBlockers: async () => [] }));
mock.module("../src/lib/lead-installer-confirm.server", () => ({ assertLeadInstallerUnlocked: async () => {} }));
mock.module("../src/lib/in-house-electrician.server", () => ({ allocatedWorkerId: async () => null, inHousePiesaBookingBlockerFor: async () => null }));

const booking = await import("../src/lib/booking.server");
beforeEach(() => { state.stage = "installation_scheduling"; state.clearance = base; state.deposit = null; state.ownerConfirm = null; state.entryBlockers = []; });
const run = () => booking.validateBooking(J, "installation", INSTALL_START, "u-office");

describe("validateBooking('installation'): booking before the upgrades day", () => {
  test("deposit paid, upgrades still to come, everything else fine → allowed with the warning", async () => {
    const r = await run();
    expect(r.stage).toBe("installation_scheduling");
    expect(r.target).toBe("installation_booked");
    expect(r.warnings).toEqual([UPGRADES_NOT_DONE_WARNING]);
  });
  test("the 30 days still run from the official PIESA date while the upgrades are outstanding (decision 316)", async () => {
    await expect(booking.validateBooking(J, "installation", OUTSIDE_START, "u-office")).rejects.toThrow(`Installation must be on or before ${DEADLINE}`);
  });
  test("deposit NOT paid → still refused with the existing deposit text (answer 21)", async () => {
    state.deposit = INSTALL_DEPOSIT_BLOCKER;
    await expect(run()).rejects.toThrow(`Blocked: ${INSTALL_DEPOSIT_BLOCKER}`);
  });
  test("PIESA failed for another reason (PIESA did not pass, no upgrades) → still throws, no warning", async () => {
    state.clearance = { ...base, rectificationRequired: false };
    await expect(run()).rejects.toThrow("Installation cannot be arranged yet: PIESA did not pass.");
  });
  test("cleared → no warning", async () => {
    state.clearance = { ...base, piesaOutcome: "pass", rectificationRequired: false };
    expect((await run()).warnings).toEqual([]);
  });
  // J5 (4 Nov 2026, controller ruling on Task 10's UNDECIDED): the install may be booked BEFORE the upgrades day — from
  // piesa_complete (upgrades outstanding), rectification_scheduling and rectification_booked — recorded at the current stage
  // with no stage move (target = stage), the installation_booked entry blockers applying at the later move, not here.
  test("J5 ruling: booked before the upgrades day from the rectification stages — allowed with the warning, no stage move, no entry-blocker pre-check", async () => {
    for (const stage of ["rectification_scheduling", "rectification_booked", "piesa_complete"]) {
      state.stage = stage; state.entryBlockers = ["Gate B not signed"]; // would refuse a move to installation_booked — applies at that move, later
      const r = await run();
      expect(r).toEqual({ stage, target: stage, warnings: [UPGRADES_NOT_DONE_WARNING], beforeUpgrades: true });
    }
  });
  test("J5 ruling: the deposit and the owner's PIESA confirmation still refuse at those stages; a job there for another reason (PIESA did not pass) is refused as before", async () => {
    state.stage = "rectification_booked"; state.deposit = INSTALL_DEPOSIT_BLOCKER;
    await expect(run()).rejects.toThrow(`Blocked: ${INSTALL_DEPOSIT_BLOCKER}`);
    state.deposit = null; state.ownerConfirm = "Waiting for the owner to confirm the safety check";
    await expect(run()).rejects.toThrow("Waiting for the owner to confirm the safety check");
    state.ownerConfirm = null; state.stage = "piesa_complete"; state.clearance = { ...base, rectificationRequired: false };
    await expect(run()).rejects.toThrow("Installation cannot be arranged yet: PIESA did not pass.");
    state.stage = "rectification_required"; state.clearance = base; // not one of the ruling's stages
    await expect(run()).rejects.toThrow("A installation booking can't be made at");
  });
  test("owner PIESA confirmation (decision 296) and stage-entry blockers still refuse", async () => {
    state.ownerConfirm = "Waiting for the owner to confirm the safety check";
    await expect(run()).rejects.toThrow("Waiting for the owner to confirm the safety check");
    state.ownerConfirm = null; state.entryBlockers = ["Gate B not signed"];
    await expect(run()).rejects.toThrow("Blocked: Gate B not signed");
  });
});
