// New job flow Part 9 Task 8 (Jo 2 Nov 2026): insurance and licence are a HARD block until the office approves —
// public liability on file, office-verified, $5m+, workers comp, unexpired; an upload alone never lifts the block;
// reminders 30 and 7 days before expiry to the business email AND info@ (two sends, one key each), held until approved.
import { describe, expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { memoryPostgrest } from "./helpers/memory-postgrest";
import { BUSINESS_DOCS_WORDS, businessDocsBlocker, expiredBusinessDocsBlocker, insuranceDocProblems, latestVerifiedCredential } from "../src/lib/trade-expiry.core";
import { latestExpiry, type CredentialView } from "../src/lib/trade-view.core";
import { PUBLIC_LIABILITY_MISSING, publicLiabilityBlocker } from "../src/lib/worker-compliance.core";
import { prestartFailures } from "../src/lib/prestart.core";
import * as reminderCore from "../src/lib/insurance-reminder.core";
import * as melbourne from "../src/lib/melbourne-time.core";
import * as testSendCore from "../src/lib/test-send.core";
import * as tradeExpiryCore from "../src/lib/trade-expiry.core";
import * as workerCompliance from "../src/lib/worker-compliance.core";

const TODAY = "2026-11-04";
const PL = "Public liability insurance";
const WC = "Workers compensation insurance";
const pl = (expires: string | null, verified: boolean, amountInsured?: number | null): CredentialView => ({ kind: "public_liability_insurance", label: "Public liability", expires, verified, pending: !verified, ...(amountInsured === undefined ? {} : { amountInsured }) });
const wc = (expires: string | null, verified = true): CredentialView => ({ kind: "workers_comp_insurance", label: "Workers comp", expires, verified, pending: !verified });
const OK = [pl("2027-06-30", true, 10_000_000), wc("2027-06-30")];

describe("businessDocsBlocker: the hard block (pure)", () => {
  test("everything verified, $10m, current → no block", () => {
    expect(businessDocsBlocker(OK, TODAY)).toBeNull();
  });
  test("expired verified + a fresh unverified upload → still blocked, with the 'waiting to check' line", () => {
    const creds = [pl("2026-10-01", true, 10_000_000), pl("2027-10-01", false), wc("2027-06-30")];
    expect(businessDocsBlocker(creds, TODAY)).toBe(BUSINESS_DOCS_WORDS.expiredWaiting(PL, "2026-10-01"));
    // latestExpiry on its own still sees the upload; verifiedOnly is what the gate reads.
    expect(latestExpiry(creds, "public_liability_insurance")).toBe("2027-10-01");
    expect(latestExpiry(creds, "public_liability_insurance", { verifiedOnly: true })).toBe("2026-10-01");
  });
  test("the office verifies the new upload (with the amount) → clear", () => {
    expect(businessDocsBlocker([pl("2026-10-01", true, 10_000_000), pl("2027-10-01", true, 5_000_000), wc("2027-06-30")], TODAY)).toBeNull();
    expect(latestVerifiedCredential([pl("2026-10-01", true, 10_000_000), pl("2027-10-01", true, 5_000_000)], "public_liability_insurance")?.amountInsured).toBe(5_000_000);
  });
  test("no public liability on file → blocked", () => {
    expect(businessDocsBlocker([wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.notOnFile(PL));
    expect(businessDocsBlocker([], TODAY)).toBe(`${BUSINESS_DOCS_WORDS.notOnFile(PL)} ${BUSINESS_DOCS_WORDS.notOnFile(WC)}`);
  });
  test("uploaded but not yet verified → blocked ('waiting to check'); rejected only → not on file", () => {
    expect(businessDocsBlocker([pl("2027-06-30", false), wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.waitingCheck(PL));
    expect(businessDocsBlocker([{ ...pl("2027-06-30", false), pending: false }, wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.notOnFile(PL));
  });
  test("public liability $2m verified → blocked; null amount on a verified row → 'amount not recorded'", () => {
    expect(businessDocsBlocker([pl("2027-06-30", true, 2_000_000), wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.amountLow(PL, 2_000_000));
    expect(businessDocsBlocker([pl("2027-06-30", true, null), wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.amountMissing(PL));
    expect(businessDocsBlocker([pl("2027-06-30", true), wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.amountMissing(PL));
    expect(businessDocsBlocker([pl("2027-06-30", true, 5_000_000), wc("2027-06-30")], TODAY)).toBeNull();
  });
  test("a verified row with no expiry date → blocked (missing date never clears)", () => {
    expect(businessDocsBlocker([pl(null, true, 10_000_000), wc("2027-06-30")], TODAY)).toBe(BUSINESS_DOCS_WORDS.noExpiry(PL));
  });
  test("workers comp missing → blocked; exempt (employs nobody) → not needed; expired → blocked", () => {
    expect(businessDocsBlocker([pl("2027-06-30", true, 10_000_000)], TODAY)).toBe(BUSINESS_DOCS_WORDS.notOnFile(WC));
    expect(businessDocsBlocker([pl("2027-06-30", true, 10_000_000)], TODAY, { workersCompExempt: true })).toBeNull();
    expect(businessDocsBlocker([pl("2027-06-30", true, 10_000_000), wc("2026-11-03")], TODAY)).toBe(BUSINESS_DOCS_WORDS.expired(WC, "2026-11-03"));
    expect(insuranceDocProblems([wc("2026-11-04")], "workers_comp_insurance", TODAY)).toEqual([]); // expires today = still current
  });
  test("several problems are all said; expiry-only rule for the installer certificate is unchanged", () => {
    expect(businessDocsBlocker([pl("2026-10-01", true, 2_000_000)], TODAY)).toBe([BUSINESS_DOCS_WORDS.expired(PL, "2026-10-01"), BUSINESS_DOCS_WORDS.amountLow(PL, 2_000_000), BUSINESS_DOCS_WORDS.notOnFile(WC)].join(" "));
    expect(expiredBusinessDocsBlocker([{ kind: "installer_certification", label: "CII", expires: "2026-10-01", verified: true }], TODAY, ["installer_certification"])).toContain("expired on 2026-10-01");
    expect(expiredBusinessDocsBlocker([], TODAY, ["installer_certification"])).toBeNull();
  });
  test("publicLiabilityBlocker: no date on file now blocks; pre-start lists the business problems", () => {
    expect(publicLiabilityBlocker(null, TODAY)).toBe(PUBLIC_LIABILITY_MISSING);
    expect(publicLiabilityBlocker("2027-01-01", TODAY)).toBeNull();
    const base = {
      start: "2026-10-30T22:00:00Z", clearance: { cleared: true, blocker: null }, deadline: "2026-11-20",
      esc: { status: "sent", sent_at: "2026-10-27T00:00:00Z", submission_reference: "REF", scheduled_start: "2026-10-30T22:00:00Z" },
      lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Deep", noticeAcknowledged: true },
      consentBlockers: [], piesaCompletedAt: "2026-10-20T00:00:00Z",
    } as unknown as Parameters<typeof prestartFailures>[0];
    expect(prestartFailures({ ...base, businessDocsBlocker: businessDocsBlocker([], TODAY) })).toContain(`Installer business: ${BUSINESS_DOCS_WORDS.notOnFile(PL)} ${BUSINESS_DOCS_WORDS.notOnFile(WC)}`);
  });
});

describe("dueInsuranceReminder (pure)", () => {
  const { dueInsuranceReminder, insuranceReminderKey, renderInsuranceReminder, INSURANCE_REMINDER_APPROVED } = reminderCore;
  test("30 at 30 days, 7 at 7 days, once each; nothing after expiry or far out", () => {
    expect(dueInsuranceReminder("2026-12-04", TODAY, [])).toBe(30);
    expect(dueInsuranceReminder("2026-12-05", TODAY, [])).toBeNull();
    expect(dueInsuranceReminder("2026-12-04", TODAY, [30])).toBeNull();
    expect(dueInsuranceReminder("2026-11-11", TODAY, [30])).toBe(7);
    expect(dueInsuranceReminder("2026-11-11", TODAY, [30, 7])).toBeNull();
    expect(dueInsuranceReminder("2026-11-04", TODAY, [])).toBe(7); // expires today: the last reminder still goes
    expect(dueInsuranceReminder("2026-11-03", TODAY, [])).toBeNull(); // expired: the block says it, no reminder
    expect(dueInsuranceReminder("2026-11-11", TODAY, [])).toBe(7); // a late tick sends the step that is due, never the missed 30
  });
  test("keys and DRAFT wording; the flag is off", () => {
    expect(INSURANCE_REMINDER_APPROVED).toBe(false);
    expect(insuranceReminderKey("b1", "public_liability_insurance", "2026-12-04", 30)).toBe("insurance-reminder:v1:b1:public_liability_insurance:2026-12-04:30");
    expect(insuranceReminderKey("b1", "worker_licence", "2026-12-04", 7, "w1")).toBe("insurance-reminder:v1:b1:worker_licence:w1:2026-12-04:7");
    const m = renderInsuranceReminder({ kind: "public_liability_insurance", expiresOn: "2026-12-04", businessName: "Rapid Insulation" });
    expect(m.subject).toBe("Your public liability insurance expires on Fri 4 Dec 2026");
    expect(m.text).toContain("Upload the new one on My business before Fri 4 Dec 2026. Until Home Insulation Victoria has checked it, you can't take new jobs, bookings or installs.");
    expect(renderInsuranceReminder({ kind: "worker_licence", expiresOn: "2026-12-04", businessName: "Sparks Pty Ltd", person: "Will Casdorff" }).subject).toBe("Will Casdorff's electrical licence expires on Fri 4 Dec 2026");
  });
});

// ── server: the sweep (real insurance-reminder.server against an in-memory database, senders recorded) ──────────────
function transpiled(path: string, deps: Record<string, unknown>) {
  const api: Record<string, unknown> = {};
  new Function("exports", "require", ts.transpile(readFileSync(path, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (p: string) => { if (!(p in deps)) throw new Error(`Unmocked dependency ${p}`); return deps[p]; });
  return api;
}
type AnyRow = Record<string, unknown>;
function sweepFixture() {
  const rows: Record<string, AnyRow[]> = {
    businesses: [{ id: "b1", name: "Rapid Insulation", email: "office@rapid.example", onboarding_notes: null, is_active: true, onboarding_status: "approved" }],
    business_credentials: [{ id: "c1", business_id: "b1", kind: "public_liability_insurance", label: "Public liability", expires_at: "2026-12-04", verification: "verified" }],
    partner_workers: [], admin_config_events: [],
  };
  const sends: { to: string; key: string; subject: string; test?: boolean }[] = [];
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: memoryPostgrest(rows as never) },
    "./insurance-reminder.core": reminderCore, "./melbourne-time.core": melbourne, "./test-send.core": testSendCore,
    "./comms.server": { customerCommsEnabled: async () => true },
    "./trade-pause.server": { tradeMessagesPausedNow: async () => null },
    "./office-email.server": { sendOfficeEmail: async (p: { to: string; idempotencyKey: string; subject: string }) => { sends.push({ to: p.to, key: p.idempotencyKey, subject: p.subject }); return { status: "sent", detail: "ok" }; } },
    "./test-send.server": { sendTestEmail: async (ctx: { label: string }, to: string, subject: string) => { sends.push({ to, key: ctx.label, subject, test: true }); return { status: "sent", detail: "test" }; } },
  };
  const api = transpiled("src/lib/insurance-reminder.server.ts", deps) as { sweepInsuranceReminders: (now: Date, o?: { approved?: boolean }) => Promise<{ checked: number; sent: number; held: number }> };
  return { rows, sends, api, deps };
}
const at = (ymd: string) => new Date(`${ymd}T03:00:00Z`); // 2pm Melbourne (AEDT)

describe("sweepInsuranceReminders (server)", () => {
  test("30 days before: one email to the business AND one to info@, one key each; the same day again sends nothing; 7 days later the second step", async () => {
    const f = sweepFixture();
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(f.sends.map((s) => [s.to, s.key])).toEqual([
      ["office@rapid.example", "insurance-reminder:v1:b1:public_liability_insurance:2026-12-04:30"],
      ["info@homeinsulationvictoria.com.au", "insurance-reminder:v1:b1:public_liability_insurance:2026-12-04:30:office"],
    ]);
    expect(f.sends[0]!.subject).toBe("Your public liability insurance expires on Fri 4 Dec 2026");
    expect(f.rows["admin_config_events"]!.filter((e) => e["event_type"] === "insurance_reminder_sent")).toHaveLength(2);
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(await f.api.sweepInsuranceReminders(at("2026-11-20"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(await f.api.sweepInsuranceReminders(at("2026-11-27"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(f.sends).toHaveLength(4);
    expect(f.sends[2]!.key).toBe("insurance-reminder:v1:b1:public_liability_insurance:2026-12-04:7");
    expect(f.sends[3]!.key).toBe("insurance-reminder:v1:b1:public_liability_insurance:2026-12-04:7:office");
    expect(await f.api.sweepInsuranceReminders(at("2026-11-27"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
  });
  test("real business, wording not approved (the default) → held once per key, nothing sent; TEST partner → test-send", async () => {
    const f = sweepFixture();
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"))).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"))).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(f.sends).toEqual([]);
    const held = f.rows["admin_config_events"]!.filter((e) => e["event_type"] === "insurance_reminder_held");
    expect(held).toHaveLength(1);
    expect((held[0]!["details"] as { reason: string }).reason).toBe("wording not approved yet");
    f.rows["businesses"]![0]!["onboarding_notes"] = testSendCore.TEST_PARTNER_MARK;
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"))).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(f.sends.map((s) => s.test)).toEqual([true, true]);
    expect(f.sends[0]!.subject).toContain("[TEST]");
  });
  test("an electrician's own licence reminds the business email the same way; a sender block holds and never claims", async () => {
    const f = sweepFixture();
    f.rows["business_credentials"] = [];
    f.rows["partner_workers"] = [{ id: "w1", business_id: "b1", trade_role: "electrician", removed_at: null, full_legal_name: "Will Casdorff", licence_expires_on: "2026-11-11" }];
    (f.deps["./office-email.server"] as { sendOfficeEmail: unknown }).sendOfficeEmail = async () => ({ status: "blocked", detail: "Messages paused" });
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(f.rows["admin_config_events"]!.filter((e) => e["event_type"] === "insurance_reminder_sent")).toHaveLength(0);
    (f.deps["./office-email.server"] as { sendOfficeEmail: unknown }).sendOfficeEmail = async (p: { to: string; idempotencyKey: string; subject: string }) => { f.sends.push({ to: p.to, key: p.idempotencyKey, subject: p.subject }); return { status: "sent", detail: "ok" }; };
    expect(await f.api.sweepInsuranceReminders(at("2026-11-04"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(f.sends.map((s) => s.key)).toEqual(["insurance-reminder:v1:b1:worker_licence:w1:2026-11-11:7", "insurance-reminder:v1:b1:worker_licence:w1:2026-11-11:7:office"]);
    expect(f.sends[0]!.subject).toBe("Will Casdorff's electrical licence expires on Wed 11 Nov 2026");
  });
});

// ── server: validateBooking throws the blocker for an installation and for a Ready Check ────────────────────────────
class WorkflowError extends Error {}
/** A client whose reads of `table` answer `{ error }` (a database read failure), every other table as normal. */
function failingReads(shim: { from: (t: string) => unknown }, table: string) {
  const failed = { data: null, error: { code: "XX000", message: `read failed: ${table}` } };
  const chain: Record<string, unknown> = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(failed).then(res) : () => chain) });
  return { from: (t: string) => (t === table ? chain : shim.from(t)) };
}
function bookingFixture(creds: AnyRow[], biz: AnyRow = { id: "biz", name: "Rapid Insulation", business_type: "eec_installer", onboarding_status: "approved", is_active: true, capabilities: ["installer"], workcover_exempt_declared_at: null }) {
  const rows: Record<string, AnyRow[]> = {
    jobs: [{ id: "j", stage: "installation_scheduling" }],
    job_assignments: [{ id: "a1", job_id: "j", role: "installer", active: true, user_id: "u1", business_id: "biz" }],
    businesses: [biz], business_credentials: creds, partner_workers: [], bookings: [], workflow_events: [],
  };
  const base = memoryPostgrest(rows as never);
  const failing: { table: string | null } = { table: null };
  const shim = { from: (t: string) => (failing.table ? failingReads(base, failing.table) : base).from(t) };
  let stage = "installation_scheduling";
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: shim },
    "./workflow.server": { WorkflowError, getStage: async () => stage, commercialBlocker: async () => null, paymentGate: async () => ({ cleared: true }), piesaStatus: async () => ({ install_deadline: null }), logEvent: async () => {}, transition: async () => {}, stageEntryBlockers: async () => [] },
    "./workflow": { installationDateBlocker: () => null, STAGE_LABEL: {} },
    "./install-days.core": { installEndAt: (s: string) => s, installWindowDeadline: () => "2026-12-31", installDayOutsideWindow: () => false, NEW_PIESA_NEEDED: "new PIESA" },
    "./invoice-dates.server": {}, "./autoadvance.server": {},
    "./allocation.server": { clearanceFacts: async () => ({}) }, "./allocation.core": { electricalClearance: () => ({ cleared: true, timingDate: "2026-11-01" }), installationCoordinationBlocker: () => null, installationCoordination: () => ({ block: null, warn: null }) }, // + Task 10's warn/block split (join)
    "./esc.core": { bookingLeadBlocker: () => null },
    "./piesa-owner-confirm.server": { ownerPiesaConfirmationBlockerFor: async () => null },
    "./pilot.server": { requireApprovedPartner: async () => ({}) },
    "./payments.server": { installDepositBlockerFor: async () => null },
    "./job-live.server": { jobDeletedBlocker: async () => null },
    "./in-house-electrician.server": { allocatedWorkerId: async () => null },
    "./worker-compliance.core": workerCompliance,
    "./trade-expiry.core": tradeExpiryCore, "./melbourne-time.core": melbourne,
  };
  deps["./business-docs.server"] = transpiled("src/lib/business-docs.server.ts", deps);
  deps["./lead-installer-confirm.server"] = { assertLeadInstallerUnlocked: async () => {} };
  deps["./people-on-file.server"] = { requirePeopleOnFileForBooking: async () => {} };
  const api = transpiled("src/lib/booking.server.ts", deps) as { validateBooking: (jobId: string, kind: string, start: string, actor: string | null) => Promise<unknown> };
  return { api, rows, setStage: (s: string) => { stage = s; }, failReads: (table: string) => { failing.table = table; } };
}
const GOOD = [{ id: "c1", business_id: "biz", kind: "public_liability_insurance", label: "Public liability", expires_at: "2027-06-30", verification: "verified", amount_insured_aud: "10000000" }, { id: "c2", business_id: "biz", kind: "workers_comp_insurance", label: "Workers comp", expires_at: "2027-06-30", verification: "verified" }];

describe("validateBooking: the insurance gate on every kind (server)", () => {
  test("installation: public liability verified but under $5m → throws the blocker; $10m → allowed", async () => {
    const low = bookingFixture([{ ...GOOD[0]!, amount_insured_aud: "2000000" }, GOOD[1]!]);
    await expect(low.api.validateBooking("j", "installation", "2026-11-20T21:00:00Z", null)).rejects.toThrow(BUSINESS_DOCS_WORDS.amountLow(PL, 2_000_000));
    const ok = bookingFixture(GOOD);
    await expect(ok.api.validateBooking("j", "installation", "2026-11-20T21:00:00Z", null)).resolves.toEqual({ stage: "installation_scheduling", target: "installation_booked", warnings: [] });
  });
  test("Ready Check: the renewal is uploaded but not checked yet → throws; verified → allowed", async () => {
    const f = bookingFixture([{ ...GOOD[0]!, expires_at: "2026-10-01" }, { id: "c3", business_id: "biz", kind: "public_liability_insurance", label: "Public liability", expires_at: "2027-10-01", verification: "pending" }, GOOD[1]!]);
    f.setStage("ready_check_ready_to_schedule");
    await expect(f.api.validateBooking("j", "ready_check", "2026-11-10T21:00:00Z", null)).rejects.toThrow(BUSINESS_DOCS_WORDS.expiredWaiting(PL, "2026-10-01"));
    f.rows["business_credentials"]![1]!["verification"] = "verified"; f.rows["business_credentials"]![1]!["amount_insured_aud"] = "5000000";
    await expect(f.api.validateBooking("j", "ready_check", "2026-11-10T21:00:00Z", null)).resolves.toEqual({ stage: "ready_check_ready_to_schedule", target: "ready_check_scheduled", warnings: [] });
  });
  test("nothing on file → throws (an installation never books on a missing certificate); a read failure blocks", async () => {
    const f = bookingFixture([]);
    await expect(f.api.validateBooking("j", "installation", "2026-11-20T21:00:00Z", null)).rejects.toThrow(BUSINESS_DOCS_WORDS.notOnFile(PL));
    const broken = bookingFixture(GOOD);
    broken.failReads("business_credentials"); // the insurance rows can't be read → refused, never "no block"
    await expect(broken.api.validateBooking("j", "installation", "2026-11-20T21:00:00Z", null)).rejects.toThrow(/Couldn't read insurance records: read failed/);
  });
});
