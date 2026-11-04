// New job flow, Part 6, Task 7: the upgrades day on the job — nudges when the upgrades form isn't in, and the 30-day red flag.
// Pure rules first; then the REAL sweep against an in-memory database with recording senders. Own file: it mocks modules.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import {
  UPGRADES_NUDGE_TEXT_APPROVED, UPGRADES_OFFICE_EMAIL_APPROVED, UPGRADES_RED_FLAG_EMAIL_APPROVED, UPGRADES_NUDGE_SMS_TYPE,
  installBeforeUpgradesWarning, upgradesNudgeDue, upgradesPastWindow, upgradesNudgeText, upgradesOfficeEmail, upgradesRedFlagEmail, upgradesWatchKeys,
} from "../src/lib/upgrades-watch.core";

const mel = (s: string) => new Date(s); // ISO with the Melbourne offset written out
const UP = "2026-11-10T23:00:00.000Z"; // Wed 11 Nov 2026 10:00am Melbourne (AEDT)

describe("upgrades-watch.core: rules", () => {
  test("upgradesNudgeDue: nothing on the day, the electrician from 9am the day after, the office the day after that once the electrician was nudged, nothing once the form is in", () => {
    const f = { upgradesYmd: "2026-11-11", formDone: false, nudgedElectrician: false, emailedOffice: false };
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-11T16:00:00+11:00") })).toBeNull();
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-12T08:59:00+11:00") })).toBeNull();
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-12T09:00:00+11:00") })).toBe("electrician");
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-12T09:00:00+11:00"), nudgedElectrician: true })).toBeNull();
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-13T08:59:00+11:00"), nudgedElectrician: true })).toBeNull();
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-13T09:00:00+11:00"), nudgedElectrician: true })).toBe("office");
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-13T09:00:00+11:00"), nudgedElectrician: true, emailedOffice: true })).toBeNull();
    // Not nudged yet on Friday (the text was held): still the electrician's turn, the office follows.
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-13T09:00:00+11:00") })).toBe("electrician");
    expect(upgradesNudgeDue({ ...f, now: mel("2026-11-13T09:00:00+11:00"), formDone: true })).toBeNull();
  });
  test("upgradesPastWindow: on or after the 30-day install deadline = true (an upgrades day ON the deadline can't install in time), before it = false", () => {
    expect(upgradesPastWindow({ upgradesYmd: "2026-12-08", installDeadlineYmd: "2026-12-06" })).toBe(true);
    expect(upgradesPastWindow({ upgradesYmd: "2026-12-06", installDeadlineYmd: "2026-12-06" })).toBe(true);
    expect(upgradesPastWindow({ upgradesYmd: "2026-12-05", installDeadlineYmd: "2026-12-06" })).toBe(false);
  });
  test("installBeforeUpgradesWarning: the DRAFT line when the install is before the upgrades day, never a block", () => {
    expect(installBeforeUpgradesWarning({ installStart: "2026-11-09T23:00:00Z", upgradesStart: UP })).toBe("The upgrades are booked for Wed 11 Nov. You can still book the install, but it can't start until the certificate is in.");
    expect(installBeforeUpgradesWarning({ installStart: "2026-11-11T23:00:00Z", upgradesStart: UP })).toBeNull();
    expect(installBeforeUpgradesWarning({ installStart: "2026-11-09T23:00:00Z", upgradesStart: null })).toBeNull();
  });
  test("DRAFT wording behind its own flags (all false); plain, no 'fixes', no 'HIV'", () => {
    expect(UPGRADES_NUDGE_TEXT_APPROVED).toBe(true); // ON at go-live 5 Nov 2026
    expect(UPGRADES_OFFICE_EMAIL_APPROVED).toBe(true);
    expect(UPGRADES_RED_FLAG_EMAIL_APPROVED).toBe(true);
    expect(UPGRADES_NUDGE_SMS_TYPE).toBe("upgrades_nudge");
    expect(upgradesNudgeText({ jobNumber: "HV-5001", url: "https://x/e/T" })).toBe("Home Insulation Victoria: HV-5001 upgrades were booked for yesterday. Open your job link to fill in the upgrades form: https://x/e/T");
    const o = upgradesOfficeEmail({ jobNumber: "HV-5001", electrician: "Spark Co", upgradesStart: UP, test: false });
    expect(o.subject).toBe("HV-5001: upgrades form not in");
    expect(o.text).toContain("Wed 11 Nov");
    const r = upgradesRedFlagEmail({ jobNumber: "HV-5001", electrician: "Spark Co", upgradesStart: UP, installDeadlineYmd: "2026-11-06", test: false });
    expect(r.subject).toBe("HV-5001: upgrades day is past the 30-day rule");
    expect(r.text).toContain("Fri 6 Nov");
    for (const t of [o.text, r.text, upgradesNudgeText({ jobNumber: "HV-1", url: "u" })]) expect(t).not.toMatch(/\bfixes\b|\bHIV\b/);
    expect(upgradesWatchKeys("j1", "2026-11-11")).toEqual({ nudge: "upgrades-nudge:v1:j1:2026-11-11", office: "upgrades-office:v1:j1:2026-11-11", redFlag: "upgrades-red-flag:v1:j1:2026-11-11" });
  });
});

// ---------------- the sweep ----------------
const J = "00000000-0000-4000-8000-0000000000a1", INST = "00000000-0000-4000-8000-0000000000b1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const W = "00000000-0000-4000-8000-0000000000c1", USER = "00000000-0000-4000-8000-0000000000d1";
const tables: Tables = {};
const calls: { sms: unknown[][]; testSms: unknown[][]; office: Record<string, unknown>[]; testMail: unknown[][]; link: unknown[][]; retire: unknown[][]; revoke: unknown[][] } = { sms: [], testSms: [], office: [], testMail: [], link: [], retire: [], revoke: [] };
const order: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t) } }));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ id: `e${tables["workflow_events"]!.length}`, job_id: jobId, actor_id: actorId, event_type: eventType, summary, details, created_at: new Date().toISOString() });
  },
}));
const server = await import("../src/lib/upgrades-watch.server");
// The three flags are ON since go-live 5 Nov 2026: the "flag off" cases below pass them as false explicitly.
const deps = (over: Record<string, unknown> = {}) => ({
  nudgeApproved: false, officeApproved: false, redFlagApproved: false,
  sendSms: async (i: unknown) => { calls.sms.push([i]); return { status: "sent", detail: "ok" }; },
  sendTestSms: async (...a: unknown[]) => { calls.testSms.push(a); order.push("send"); return { channel: "sms", to: a[1], status: smsStatus, detail: "test" }; },
  sendOfficeEmail: async (p: Record<string, unknown>) => { calls.office.push(p); return { channel: "email", to: p["to"], status: "sent", detail: "ok" }; },
  sendTestEmail: async (...a: unknown[]) => { calls.testMail.push(a); return { channel: "email", to: a[1], status: "sent", detail: "test" }; },
  mintLink: async (...a: unknown[]) => { calls.link.push(a); order.push("mint"); return { id: "link-new", url: "https://x/e/NEW" }; },
  retireOlderLinks: async (...a: unknown[]) => { calls.retire.push(a); order.push("retire"); },
  revokeLink: async (...a: unknown[]) => { calls.revoke.push(a); order.push("revoke"); },
  ...over,
}) as never;

let smsStatus = "sent";
function seed(over: { source?: string; upgradesStart?: string | null; deadline?: string; formDone?: boolean; stage?: string } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(calls)) (calls as Record<string, unknown[]>)[k]!.length = 0;
  order.length = 0; smsStatus = "sent";
  tables["jobs"] = [{ id: J, job_number: "HV-5001", source: over.source ?? "qa_test", stage: over.stage ?? "rectification_booked", deleted_at: null }];
  tables["businesses"] = [
    { id: INST, name: "Smith Insulation", trading_name: null, email: "office@smith.test", onboarding_notes: null },
    { id: ELEC, name: "Spark Co", trading_name: null, email: "office@spark.test", onboarding_notes: null },
  ];
  tables["job_assignments"] = [
    { id: "a1", job_id: J, business_id: INST, role: "installer", active: true, user_id: null },
    { id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true, user_id: USER },
  ];
  tables["partner_workers"] = [{ id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: USER }];
  const start = "upgradesStart" in over ? over.upgradesStart : UP;
  tables["bookings"] = start ? [{ id: "bk1", job_id: J, kind: "rectification", status: "confirmed", scheduled_start: start, business_id: ELEC, assignment_id: "a2", contractor_id: USER }] : [];
  tables["job_piesa_deadlines"] = [{ job_id: J, install_deadline: over.deadline ?? "2026-12-01" }];
  tables["workflow_events"] = [{ id: "fx", job_id: J, event_type: "fixes_form_created", summary: "", details: { audit_id: "audit-a4" }, created_at: "2026-11-01T00:00:00Z" }];
  if (over.formDone) tables["workflow_events"]!.push({ id: "fd", job_id: J, event_type: "fixes_form_completed", summary: "", details: { audit_id: "audit-a4" }, created_at: "2026-11-11T05:00:00Z" });
}
beforeEach(() => seed());
const events = (t: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === t);
const THU = mel("2026-11-12T09:05:00+11:00"), FRI = mel("2026-11-13T09:05:00+11:00");

describe("sweepUpgradesWatch: the electrician nudge", () => {
  test("Wednesday: nothing", async () => {
    expect(await server.sweepUpgradesWatch(mel("2026-11-11T16:00:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.testSms).toHaveLength(0);
  });
  test("Thursday 9am, TEST job: one nudge text to the electrician through test-send with a fresh job link; recorded once by key; a second tick sends nothing", async () => {
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 1, officeEmails: 0, redFlags: 0 });
    expect(calls.link[0]!.slice(0, 2)).toEqual([J, W]);
    expect(calls.testSms).toHaveLength(1);
    expect(calls.testSms[0]![1]).toBe("0422 222 222");
    expect(calls.testSms[0]![2]).toBe("Home Insulation Victoria: HV-5001 upgrades were booked for yesterday. Open your job link to fill in the upgrades form: https://x/e/NEW");
    const ev = events("upgrades_nudge");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ key: "upgrades-nudge:v1:" + J + ":2026-11-11", worker_id: W, booking_id: "bk1", sent: true });
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.testSms).toHaveLength(1);
    expect(events("upgrades_nudge")).toHaveLength(1);
  });
  test("I3: the working link is kept until the text has gone — mint (keeping the older link) → send → retire the older ones; a failed send revokes the new link and keeps the old", async () => {
    await server.sweepUpgradesWatch(THU, deps());
    expect(order).toEqual(["mint", "send", "retire"]);
    expect(calls.retire[0]).toEqual([J, W, "link-new"]);
    expect(calls.revoke).toHaveLength(0);
    seed(); smsStatus = "blocked";
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(order).toEqual(["mint", "send", "revoke"]);
    expect(calls.revoke[0]).toEqual(["link-new"]);
    expect(calls.retire).toHaveLength(0);
    // Minor: the record says sent:false, so the next tick tries the electrician again and the office is not yet due.
    expect(events("upgrades_nudge")[0]!["details"]).toMatchObject({ sent: false });
    smsStatus = "sent";
    expect(await server.sweepUpgradesWatch(FRI, deps())).toEqual({ nudges: 1, officeEmails: 0, redFlags: 0 });
    expect(events("upgrades_nudge").map((e) => (e["details"] as { sent: boolean }).sent)).toEqual([true]); // the one record, now marked sent
    expect(calls.testMail).toHaveLength(0);
  });
  test("real job, flag off: held — nothing sent, nothing recorded, no link minted", async () => {
    seed({ source: "website" });
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.sms).toHaveLength(0);
    expect(calls.link).toHaveLength(0);
    expect(events("upgrades_nudge")).toHaveLength(0);
  });
  test("real job, flag on: the one real SMS sender, type upgrades_nudge, the key as idempotency key, token masked in the stored body", async () => {
    seed({ source: "website" });
    expect(await server.sweepUpgradesWatch(THU, deps({ nudgeApproved: true }))).toEqual({ nudges: 1, officeEmails: 0, redFlags: 0 });
    expect(calls.sms).toHaveLength(1);
    const i = calls.sms[0]![0] as Record<string, unknown>;
    expect(i).toMatchObject({ type: "upgrades_nudge", idempotencyKey: `upgrades-nudge:v1:${J}:2026-11-11`, to: "0422 222 222", jobId: J, businessId: ELEC });
    expect(i["storedBody"]).toContain("/e/••••");
  });
  test("C1: an allocated electrician with no profile (booking contractor NULL) is the one nudged, not the first worker of the business", async () => {
    tables["bookings"]![0]!["contractor_id"] = null;
    tables["partner_workers"] = [
      { id: "w-first", business_id: ELEC, full_legal_name: "First Listed", mobile: "0400 000 001", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null, created_at: "2026-01-01T00:00:00Z" },
      { id: W, business_id: ELEC, full_legal_name: "Sam Spark", mobile: "0422 222 222", trade_role: "electrician", approval_status: "approved", removed_at: null, profile_id: null, created_at: "2026-06-01T00:00:00Z" },
    ];
    tables["workflow_events"]!.push({ id: "al", job_id: J, event_type: "in_house_electrician_allocated", summary: "", details: { worker_id: W, business_id: ELEC }, created_at: "2026-11-02T00:00:00Z" });
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 1, officeEmails: 0, redFlags: 0 });
    expect(calls.link[0]!.slice(0, 2)).toEqual([J, W]);
    expect(calls.testSms[0]![1]).toBe("0422 222 222");
  });
  test("form already in: no nudge", async () => {
    seed({ formDone: true });
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
  });
  test("closed or deleted job: nothing", async () => {
    seed({ stage: "cancelled" });
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    seed(); tables["jobs"]![0]!["deleted_at"] = "2026-11-11T00:00:00Z";
    expect(await server.sweepUpgradesWatch(THU, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
  });
});

describe("sweepUpgradesWatch: the installer office email", () => {
  test("Friday 9am after the electrician was nudged, TEST job: one email to the installer office via test-send, keyed; not again", async () => {
    await server.sweepUpgradesWatch(THU, deps());
    expect(await server.sweepUpgradesWatch(FRI, deps())).toEqual({ nudges: 0, officeEmails: 1, redFlags: 0 });
    expect(calls.testMail).toHaveLength(1);
    expect(calls.testMail[0]![1]).toBe("office@smith.test");
    expect(calls.testMail[0]![2]).toBe("HV-5001: upgrades form not in");
    expect(events("upgrades_office_email")).toHaveLength(1);
    expect(events("upgrades_office_email")[0]!["details"]).toMatchObject({ key: `upgrades-office:v1:${J}:2026-11-11` });
    expect(await server.sweepUpgradesWatch(FRI, deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.testMail).toHaveLength(1);
  });
  test("real job, flag off: held; flag on: the existing office sender (partner, installer business, once-only key)", async () => {
    seed({ source: "website" });
    await server.sweepUpgradesWatch(THU, deps({ nudgeApproved: true }));
    expect(await server.sweepUpgradesWatch(FRI, deps({ nudgeApproved: true }))).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.office).toHaveLength(0);
    expect(await server.sweepUpgradesWatch(FRI, deps({ nudgeApproved: true, officeApproved: true }))).toEqual({ nudges: 0, officeEmails: 1, redFlags: 0 });
    expect(calls.office[0]).toMatchObject({ recipient: "partner", to: "office@smith.test", record: { businessId: INST }, subject: "HV-5001: upgrades form not in", idempotencyKey: `upgrades-office:v1:${J}:2026-11-11` });
  });
});

describe("sweepUpgradesWatch: the 30-day red flag", () => {
  test("upgrades day after the install deadline: the Needs me event is written once (always on), the DRAFT email is held with the flag off", async () => {
    seed({ deadline: "2026-11-06" });
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:00:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 1 });
    const ev = events("upgrades_past_30_days");
    expect(ev).toHaveLength(1);
    expect(ev[0]!["details"]).toMatchObject({ key: `upgrades-red-flag:v1:${J}:2026-11-11`, upgrades_ymd: "2026-11-11", install_deadline: "2026-11-06", booking_id: "bk1", needs_office: true });
    expect(calls.testMail).toHaveLength(1); // TEST job → test-send even with the flag off
    expect(calls.testMail[0]![2]).toBe("HV-5001: upgrades day is past the 30-day rule");
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:15:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(events("upgrades_past_30_days")).toHaveLength(1);
    expect(calls.testMail).toHaveLength(1);
  });
  test("real job: the row is written, the email is held with the flag off; a later tick with the flag on sends it ONCE (recorded first), then never again", async () => {
    seed({ source: "website", deadline: "2026-11-06" });
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:00:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 1 });
    expect(calls.office).toHaveLength(0);
    expect(events("upgrades_past_30_days")).toHaveLength(1);
    expect(events("upgrades_red_flag_email")).toHaveLength(0);
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:15:00+11:00"), deps({ redFlagApproved: true }))).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
    expect(calls.office.map((o) => o["to"])).toEqual(["office@smith.test", "info@homeinsulationvictoria.com.au"]);
    expect(events("upgrades_red_flag_email")).toHaveLength(1);
    expect(events("upgrades_past_30_days")).toHaveLength(1);
    await server.sweepUpgradesWatch(mel("2026-11-05T10:30:00+11:00"), deps({ redFlagApproved: true }));
    expect(calls.office).toHaveLength(2);
    seed({ source: "website", deadline: "2026-11-06" });
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:00:00+11:00"), deps({ redFlagApproved: true }))).toEqual({ nudges: 0, officeEmails: 0, redFlags: 1 });
    expect(calls.office.map((o) => o["to"])).toEqual(["office@smith.test", "info@homeinsulationvictoria.com.au"]);
    expect(calls.office[0]).toMatchObject({ subject: "HV-5001: upgrades day is past the 30-day rule", idempotencyKey: `upgrades-red-flag:v1:${J}:2026-11-11` });
    expect(calls.office[1]!["idempotencyKey"]).toBe(`upgrades-red-flag:v1:${J}:2026-11-11:copy`);
  });
  test("upgrades day before the deadline: no flag", async () => {
    seed({ deadline: "2026-11-12" });
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T10:00:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 0 });
  });
  test("a moved upgrades day gets its own flag (one per job + day)", async () => {
    seed({ deadline: "2026-11-06" });
    await server.sweepUpgradesWatch(mel("2026-11-05T10:00:00+11:00"), deps());
    tables["bookings"]![0]!["status"] = "cancelled";
    tables["bookings"]!.push({ id: "bk2", job_id: J, kind: "rectification", status: "confirmed", scheduled_start: "2026-11-12T23:00:00.000Z", business_id: ELEC, assignment_id: "a2", contractor_id: USER });
    expect(await server.sweepUpgradesWatch(mel("2026-11-05T11:00:00+11:00"), deps())).toEqual({ nudges: 0, officeEmails: 0, redFlags: 1 });
    expect(events("upgrades_past_30_days").map((e) => (e["details"] as { upgrades_ymd: string }).upgrades_ymd)).toEqual(["2026-11-11", "2026-11-13"]);
  });
});

describe("wiring", () => {
  test("the tick runs the sweep; the SMS type exists and is unapproved", () => {
    // Join ruling 2 (4 Nov 2026): ONE tick entry owns the three upgrades / certificate chases; this sweep is its "day passed" part.
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepUpgradesChasing");
    expect(readFileSync("src/lib/certificate-later.server.ts", "utf8")).toContain('(await import("./upgrades-watch.server")).sweepUpgradesWatch(now)');
    const sms = readFileSync("src/lib/sms.core.ts", "utf8");
    expect(sms).toMatch(/upgrades_nudge: \{ audience: "partner"[^}]*wordingApproved: false/);
  });
  test("Needs me: the office reader takes the flag from the event and clears it when the upgrades day moved or the job closed (source pin)", () => {
    const src = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(src).toContain('.eq("event_type", UPGRADES_PAST_30_DAYS_EVENT)');
    expect(src).toContain("upgradesDay.get(id) !== det.upgrades_ymd) continue;");
    expect(src).toContain('["complete", "cancelled"].includes(j.stage) || !det?.upgrades_ymd');
  });
  test("Needs me: the red flag is a row while the upgrades day still stands (office-needs core)", async () => {
    const { buildNeedsRows } = await import("../src/lib/office-needs.core");
    const base = { jobId: J, jobNumber: "HV-5001", surname: "Owner", suburb: "Kew" } as never;
    const g = buildNeedsRows({ now: Date.parse("2026-11-05T01:00:00Z"), jobs: [{ ...base, upgradesPast30: { at: "2026-11-05T00:00:00Z", upgradesYmd: "2026-11-11", deadline: "2026-11-06" } }] as never });
    const row = Object.values(g).flat().find((r) => r.kind === "upgrades_past_30_days");
    expect(row).toBeTruthy();
    expect(row!.line).toMatch(/Wed,? 11 Nov/); // the office list's own day format
    expect(row!.line).toMatch(/Fri,? 6 Nov/);
    expect(row!.line).not.toMatch(/\bfixes\b|\bHIV\b/);
  });
});
