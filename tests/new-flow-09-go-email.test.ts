// Part 9 Task 7: the GO / DON'T START email to the installer office after each GO slot run (2pm the day before, 6:30am
// on the day). Wording approved by Jo 4 Nov 2026 14:40: GO as drafted; DON'T START splits the failures into "must move"
// (a timing rule already broken → rebook) and "fix before 6:30am". GO_EMAIL_APPROVED stays false until the coordinator
// flips it: real offices get nothing (and nothing is recorded);
// info@homeinsulationvictoria.com.au gets a copy of every DON'T START, never of GO; TEST jobs go to test-send; one send
// per recipient per job + start + slot (key).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GO_EMAIL_APPROVED, GO_EMAIL_PLAIN, GO_EMAIL_TEXT, goEmail, goEmailKey, tradeSafeFailureLine } from "../src/lib/go-email.core";
import { GO_CHECK_NOT_COMPLETED, classifyPrestartFailure, classifyPrestartFailures, dueGoSlot, goSlotTimes, onDayGoCheck, type PrestartFailure } from "../src/lib/prestart.core";

const fx = (line: string): PrestartFailure => ({ line, cls: "fixable" });
const mv = (line: string): PrestartFailure => ({ line, cls: "must_move" });

const START = "2026-11-11T21:00:00Z"; // Thu 12 Nov 2026 8:00am Melbourne (AEDT)
const base = { jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", startIso: START, lead: "John Smith", link: "https://p/field/J1" };

describe("goEmail (pure, DRAFT)", () => {
  test("the flag is off in the code", () => expect(GO_EMAIL_APPROVED).toBe(false));
  test("GO at 2pm: subject and body match the draft exactly; no info@ line; button Open the job", () => {
    const m = goEmail({ ...base, failures: [], slot: "day_before_2pm" });
    expect(m.subject).toBe("HV-1234: GO for tomorrow 8:00am");
    expect(m.text).toContain("All set for 12 Example St, Box Hill VIC 3128, Thu 12 Nov, 8:00am. Lead Installer: John Smith.");
    expect(m.text).toContain("Open the job: https://p/field/J1");
    expect(m.html).toContain("Open the job");
    expect(m.text).not.toContain("check again");
    expect(m.html).not.toMatch(/\bHIV\b|lead installer/);
  });
  test("GO at 6:30am says today", () => {
    expect(goEmail({ ...base, failures: [], slot: "on_day_630am" }).subject).toBe("HV-1234: GO for today 8:00am");
  });
  test("DON'T START at 2pm, everything fixable: count, 'Fix before 6:30am:' bullets, the 6:30am line, button", () => {
    const m = goEmail({ ...base, failures: [fx("Safety plan not signed: John Smith"), fx("Install deposit not paid")], slot: "day_before_2pm" });
    expect(m.subject).toBe("HV-1234: DON'T START — 2 things missing");
    expect(m.text).toContain("Don't start the install at 12 Example St, Box Hill VIC 3128 on Thu 12 Nov, 8:00am until these are fixed:");
    expect(m.text).toContain("Fix before 6:30am:\n\n• Safety plan not signed: John Smith\n\n• Install deposit not paid");
    expect(m.text).toContain("We'll check again at 6:30am.");
    expect(m.text).not.toContain("must move"); expect(m.text).not.toContain("can't be fixed in time");
    expect(m.text).toContain("Open the job: https://p/field/J1");
    expect(m.html).toContain("Install deposit not paid");
  });
  test("DON'T START at 6:30am, everything fixable: singular, 'Fix before the install starts:', no 'check again' line", () => {
    const m = goEmail({ ...base, failures: [fx("Install deposit not paid")], slot: "on_day_630am" });
    expect(m.subject).toBe("HV-1234: DON'T START — 1 thing missing");
    expect(m.text).toContain("Fix before the install starts:\n\n• Install deposit not paid");
    expect(m.text).not.toContain("check again");
  });
  test("DON'T START, the install must move (Jo 4 Nov 14:40): subject, plain intro, the can't-be-fixed list, then the fixable list, NO 'check again' line", () => {
    const m = goEmail({ ...base, failures: [fx("Safety plan not signed: John Smith"), mv("Owner consent: Owner ESC consent was completed less than 24h before start – reschedule"), mv("The 30-day window ended on 2026-11-10. New PIESA needed.")], slot: "day_before_2pm" });
    expect(m.subject).toBe("HV-1234: DON'T START — the install must move");
    expect(m.text).toContain("Don't start the install at 12 Example St, Box Hill VIC 3128 on Thu 12 Nov, 8:00am.\n");
    expect(m.text).not.toContain("until these are fixed");
    expect(m.text).toContain("This can't be fixed in time — rebook the install for a later day and call the owner:\n\n• Owner consent: Owner ESC consent was completed less than 24h before start – reschedule\n\n• The 30-day window ended on 2026-11-10. New PIESA needed.\n\nFix before 6:30am:\n\n• Safety plan not signed: John Smith");
    expect(m.text).not.toContain("check again");
    expect(m.text).toContain("Open the job: https://p/field/J1");
    expect(m.html).toContain("rebook the install for a later day");
  });
  test("must move with nothing fixable: no 'Fix before' heading at all; the 6:30am run reads the same (no check-again line)", () => {
    for (const slot of ["day_before_2pm", "on_day_630am"] as const) {
      const m = goEmail({ ...base, failures: [mv("ESC notification was sent less than 24h before start – reschedule.")], slot });
      expect(m.subject).toBe("HV-1234: DON'T START — the install must move");
      expect(m.text).not.toContain("Fix before"); expect(m.text).not.toContain("check again");
    }
  });
  test("no Lead Installer picked reads plainly", () => {
    expect(goEmail({ ...base, lead: null, failures: [], slot: "day_before_2pm" }).text).toContain(`Lead Installer: ${GO_EMAIL_TEXT.noLead}.`);
  });
  test("classifyPrestartFailure: fixable people/paperwork/money lines; 24h-rule lines fixable only with 24h+ left; everything else must move (fail closed)", () => {
    const at2pm = { start: START, now: new Date("2026-11-11T03:00:00Z") }; // 18h before the 8am start
    const twoDaysOut = { start: START, now: new Date("2026-11-09T03:00:00Z") };
    for (const l of ["Safety plan not signed: John Smith", "No lead installer is recorded for this job.", "Lead installer Lee has no office-verified EEC CII certification.", "Lead installer Lee: re-record certification as Full with expiry date.", "Lead installer Lee holds a provisional certification, not full.", "Lead installer Lee: White Card not verified", "Installer business: public liability insurance expired on 2026-10-01", "Install deposit not paid", "Ready Check original condition not recorded: insulation.", "Site conditions differ — office review required before the quote or works can continue: note", "Life support at this home: the written consent or medical plan isn't on file.", "Certificate of Electrical Safety not in yet", "Check electrical certificate — not checked yet", "Check electrical certificate — you rejected it (blurry) — waiting for a new certificate"]) {
      expect(classifyPrestartFailure(l, at2pm), l).toBe("fixable");
    }
    for (const l of ["ESC notification is not marked submitted for this install date.", "Owner consent: Owner ESC consent not complete (owner + AP representative) – must be signed by x", "Signed PIESA copy delivery to owner must be recorded by x", "Updated PIESA (with Part C) not delivered to the installer by x", "The PIESA needs an electrician at the install and they haven't confirmed."]) {
      expect(classifyPrestartFailure(l, twoDaysOut), l).toBe("fixable");
      expect(classifyPrestartFailure(l, at2pm), l).toBe("must_move");
    }
    for (const l of ["ESC notification was sent less than 24h before start – reschedule.", "Owner consent: Owner ESC consent was completed less than 24h before start – reschedule", "The 30-day window ended on 2026-11-10. New PIESA needed.", "No 30-day window date is recorded.", "The installer safety form (PIISA) can only be done within 30 days of the PIESA.", "PIESA completion date is missing.", "Lead installer's certification expired on 2026-10-15.", "Electrical clearance is not valid: upgrades outstanding", "Something this module has never heard of"]) {
      expect(classifyPrestartFailure(l, twoDaysOut), l).toBe("must_move");
    }
    // J5 (join step 6 ruling): Task 8's read-error lines share the fixable "Installer business: " prefix — the specific line
    // wins: a read error is must move (fail closed); the real insurance lines stay fixable.
    for (const l of ["Installer business: Couldn't read insurance records: timeout", "Installer business: Couldn't read the installer assignment: boom", "Installer business: Couldn't read the business: boom", "Installer business: Couldn't read insurance records."]) {
      expect(classifyPrestartFailure(l, twoDaysOut), l).toBe("must_move");
    }
    expect(classifyPrestartFailure("Installer business: Public liability insurance not on file. Upload the certificate under My business.", twoDaysOut)).toBe("fixable");
    expect(classifyPrestartFailures(["Install deposit not paid", "x"], at2pm)).toEqual([{ line: "Install deposit not paid", cls: "fixable" }, { line: "x", cls: "must_move" }]);
  });
  // G6 S4 (final Part 9 review): any "couldn't be read / checked" or "could not be completed" line is a read error → must move.
  test("S4: 'couldn't be read/checked' and 'could not be completed' lines are must move whatever the clock says", () => {
    const twoDaysOut = { start: START, now: new Date("2026-11-09T03:00:00Z") };
    for (const l of ["Installer business: insurance couldn't be read (timeout)", "Life support plan couldn't be checked (boom)", "ESC notices could not be read (x) — check again", GO_CHECK_NOT_COMPLETED("read failed")]) {
      expect(classifyPrestartFailure(l, twoDaysOut), l).toBe("must_move");
    }
  });
  // G6 S5: the email shows a plain line per failure — never a database error, never office voice; "Lead Installer" in full.
  test("S5: trade-safe lines — read errors become one plain line (no DB text), office-voice Lead lines are reworded, 'Lead installer' is capitalised, nothing else changes", () => {
    expect(tradeSafeFailureLine("Installer business: Couldn't read insurance records: connection reset by peer")).toBe(GO_EMAIL_PLAIN.couldNotCheck);
    expect(tradeSafeFailureLine("ESC notices could not be read (relation missing) — check again")).toBe(GO_EMAIL_PLAIN.couldNotCheck);
    expect(tradeSafeFailureLine(GO_CHECK_NOT_COMPLETED("TypeError: x is undefined"))).toBe(GO_EMAIL_PLAIN.couldNotCheck);
    expect(tradeSafeFailureLine("No lead installer is recorded for this job.")).toBe(GO_EMAIL_PLAIN.noLead);
    expect(tradeSafeFailureLine("Lead installer Lee has no office-verified EEC CII certification.")).toBe(GO_EMAIL_PLAIN.leadCertNotVerified("Lee"));
    expect(tradeSafeFailureLine("Lead installer has no office-verified EEC CII certification.")).toBe(GO_EMAIL_PLAIN.leadCertNotVerified(null));
    expect(tradeSafeFailureLine("Lead installer Lee: re-record certification as Full with expiry date.")).toBe(GO_EMAIL_PLAIN.leadCertRecheck("Lee"));
    expect(tradeSafeFailureLine("ESC notification is not marked submitted for this install date.")).toBe(GO_EMAIL_PLAIN.escNotSent);
    expect(tradeSafeFailureLine("Lead installer Lee holds a provisional certification, not full.")).toBe("Lead Installer Lee holds a provisional certification, not full.");
    expect(tradeSafeFailureLine("Lead installer's certification expired on 2026-10-15.")).toBe("Lead Installer's certification expired on 2026-10-15.");
    expect(tradeSafeFailureLine("Lead installer Lee: White Card not verified")).toBe("Lead Installer Lee: White Card not verified");
    expect(tradeSafeFailureLine("Install deposit not paid")).toBe("Install deposit not paid");
    expect(tradeSafeFailureLine("Safety plan not signed: John Smith")).toBe("Safety plan not signed: John Smith");
    // In the email: two read errors collapse to ONE plain line; the DB text never appears; classification is kept.
    const m = goEmail({ ...base, failures: [mv("Installer business: Couldn't read insurance records: connection reset by peer"), mv("ESC notices could not be read (relation missing) — check again"), fx("No lead installer is recorded for this job.")], slot: "day_before_2pm" });
    expect(m.text).not.toContain("connection reset"); expect(m.text).not.toContain("relation missing"); expect(m.text).not.toMatch(/[Ll]ead installer/);
    expect(m.text.split(GO_EMAIL_PLAIN.couldNotCheck)).toHaveLength(2);
    expect(m.text).toContain(`• ${GO_EMAIL_PLAIN.couldNotCheck}`);
    expect(m.text).toContain(`Fix before 6:30am:\n\n• ${GO_EMAIL_PLAIN.noLead}`);
    expect(m.subject).toBe("HV-1234: DON'T START — the install must move");
  });
  // G6 N1: an install that starts at or before 6:30am gets its on-day check at 6:00am; the email says so.
  test("N1: a 6:30am start → the on-day slot is 6:00am and the 2pm email says 'Fix before 6:00am' / 'check again at 6:00am'; a 6:00am start has no on-day run", () => {
    const EARLY = "2026-11-11T19:30:00Z"; // Thu 12 Nov 6:30am Melbourne
    expect(goSlotTimes(EARLY)).toEqual({ day_before_2pm: "2026-11-11T03:00:00.000Z", on_day_630am: "2026-11-11T19:00:00.000Z" });
    expect(onDayGoCheck(EARLY)).toEqual({ at: "2026-11-11T19:00:00.000Z", label: "6:00am" });
    expect(onDayGoCheck(START)).toEqual({ at: "2026-11-11T19:30:00.000Z", label: "6:30am" });
    expect(dueGoSlot(EARLY, new Date("2026-11-11T19:00:00Z"), ["day_before_2pm"])).toBe("on_day_630am");
    const m = goEmail({ ...base, startIso: EARLY, failures: [fx("Install deposit not paid")], slot: "day_before_2pm" });
    expect(m.text).toContain("Fix before 6:00am:"); expect(m.text).toContain("We'll check again at 6:00am.");
    const TOO_EARLY = "2026-11-11T19:00:00Z"; // 6:00am start: no on-day run is possible
    expect(onDayGoCheck(TOO_EARLY)).toBeNull();
    expect(dueGoSlot(TOO_EARLY, new Date("2026-11-11T18:59:00Z"), ["day_before_2pm"])).toBeNull();
    const m2 = goEmail({ ...base, startIso: TOO_EARLY, failures: [fx("Install deposit not paid")], slot: "day_before_2pm" });
    expect(m2.text).toContain("Fix before the install starts:"); expect(m2.text).not.toContain("check again");
    // Unchanged for an 8am start.
    const m3 = goEmail({ ...base, failures: [fx("Install deposit not paid")], slot: "day_before_2pm" });
    expect(m3.text).toContain("Fix before 6:30am:"); expect(m3.text).toContain("We'll check again at 6:30am.");
  });
  test("the key is per job + start + slot; the info@ copy adds :office", () => {
    expect(goEmailKey("J1", START, "day_before_2pm")).toBe(`go-email:v1:J1:${START}:day_before_2pm`);
    expect(goEmailKey("J1", START, "on_day_630am")).toBe(`go-email:v1:J1:${START}:on_day_630am`);
  });
});

// ── server: sendGoEmail with an in-memory PostgREST and faked senders ────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select";
  let limit: number | null = null;
  const res = () => {
    if (op === "insert") return { data: null, error: null };
    let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (limit !== null) rows = rows.slice(0, limit);
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    limit: (n: number) => { limit = n; return q; },
    order: () => q, neq: () => q, not: () => q, or: () => q, in: () => q, gt: () => q, lt: () => q, range: () => q,
    insert: (r: Row) => { op = "insert"; (tables[t] ??= []).push({ id: crypto.randomUUID(), ...r }); return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
let leadName: string | null = "John Smith";
mock.module("../src/lib/prestart.server", () => ({ leadInstallerCert: async () => ({ found: !!leadName, name: leadName }) }));
let paused: string | null = null;
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn }));
let qaHeld = false;
mock.module("../src/lib/qa-inbox.server", () => ({ qaDeliveryHeld: async () => qaHeld }));
const office: { to: string; subject: string; key: string | undefined }[] = [];
let officeResult: { status: string; detail: string } = { status: "sent", detail: "faked" };
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; idempotencyKey?: string }) => { office.push({ to: p.to, subject: p.subject, key: p.idempotencyKey }); return officeResult; } }));
const alerts: { to: string; subject: string; key: string }[] = [];
mock.module("../src/lib/in-house-office-alert.server", () => ({ sendInHouseOfficeAlert: async (p: { to: string; subject: string; idempotencyKey: string }) => { alerts.push({ to: p.to, subject: p.subject, key: p.idempotencyKey }); return { status: "sent", detail: "faked" }; } }));
const testMail: { to: string; subject: string; label: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test.p", sendTestEmail: async (c: { label: string }, to: string, subject: string) => { testMail.push({ to, subject, label: c.label }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));

const { sendGoEmail } = await import("../src/lib/go-email.server");
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const GO = { passed: true, failures: [] as string[], start: START };
const NO = { passed: false, failures: ["Install deposit not paid"], start: START }; // fixable
const MOVE = { passed: false, failures: ["ESC notification was sent less than 24h before start – reschedule.", "Install deposit not paid"], start: START };

beforeEach(() => {
  office.length = 0; alerts.length = 0; testMail.length = 0; paused = null; commsOn = true; qaHeld = false; leadName = "John Smith"; officeResult = { status: "sent", detail: "faked" };
  tables = {
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website", deleted_at: null, properties: { address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Rapid Insulation", email: "Office@Rapid.example", onboarding_notes: null }],
    workflow_events: [],
  };
});

describe("sendGoEmail", () => {
  test("flag false (the code): a real office gets nothing and nothing is recorded — 'awaiting approval'", async () => {
    expect(await sendGoEmail("J1", "day_before_2pm", NO)).toBe("awaiting approval");
    expect(await sendGoEmail("J1", "day_before_2pm", GO)).toBe("awaiting approval");
    expect(office).toHaveLength(0); expect(alerts).toHaveLength(0); expect(testMail).toHaveLength(0);
    expect(tables["workflow_events"]).toHaveLength(0);
  });
  test("approved (overridden): GO goes to the installer office only — no info@ copy; same slot twice = one send", async () => {
    expect(await sendGoEmail("J1", "day_before_2pm", GO, { approved: true })).toMatch(/^sent/);
    expect(office).toEqual([{ to: "office@rapid.example", subject: "HV-1234: GO for tomorrow 8:00am", key: `go-email:v1:J1:${START}:day_before_2pm` }]);
    expect(alerts).toHaveLength(0);
    expect(await sendGoEmail("J1", "day_before_2pm", GO, { approved: true })).toBe("already sent");
    expect(office).toHaveLength(1);
    expect(events("go_email_sent")).toHaveLength(1);
    expect(events("go_email_sent")[0]!["details"]).toMatchObject({ key: `go-email:v1:J1:${START}:day_before_2pm`, slot: "day_before_2pm", passed: true, to: "office@rapid.example" });
  });
  test("approved: DON'T START goes to the installer office AND info@ (key :office), each once; the 6:30am slot is its own key", async () => {
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toMatch(/^sent/);
    expect(office).toEqual([{ to: "office@rapid.example", subject: "HV-1234: DON'T START — 1 thing missing", key: `go-email:v1:J1:${START}:day_before_2pm` }]);
    expect(alerts).toEqual([{ to: "info@homeinsulationvictoria.com.au", subject: "HV-1234: DON'T START — 1 thing missing", key: `go-email:v1:J1:${START}:day_before_2pm:office` }]);
    await sendGoEmail("J1", "day_before_2pm", NO, { approved: true });
    expect(office).toHaveLength(1); expect(alerts).toHaveLength(1);
    expect(await sendGoEmail("J1", "on_day_630am", NO, { approved: true })).toMatch(/^sent/);
    expect(office.map((o) => o.key)).toEqual([`go-email:v1:J1:${START}:day_before_2pm`, `go-email:v1:J1:${START}:on_day_630am`]);
    expect(alerts.map((o) => o.key)).toEqual([`go-email:v1:J1:${START}:day_before_2pm:office`, `go-email:v1:J1:${START}:on_day_630am:office`]);
    expect(events("go_email_sent")).toHaveLength(4);
  });
  test("approved: a must-move DON'T START (classed on the server) goes to the installer office AND info@ with the must-move subject", async () => {
    expect(await sendGoEmail("J1", "day_before_2pm", MOVE, { approved: true, now: new Date("2026-11-11T03:00:00Z") })).toMatch(/^sent/);
    expect(office.map((o) => o.subject)).toEqual(["HV-1234: DON'T START — the install must move"]);
    expect(alerts.map((o) => o.subject)).toEqual(["HV-1234: DON'T START — the install must move"]);
  });
  test("qa_test job → test-send even with the flag off: installer office on GO; both on DON'T START; once per recipient", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    expect(await sendGoEmail("J1", "day_before_2pm", GO)).toMatch(/^sent \(test\)/);
    expect(testMail).toEqual([{ to: "office@rapid.example", subject: "HV-1234: GO for tomorrow 8:00am", label: `go-email:v1:J1:${START}:day_before_2pm` }]);
    expect(await sendGoEmail("J1", "on_day_630am", NO)).toMatch(/^sent \(test\)/);
    expect(testMail.slice(1).map((m) => m.to)).toEqual(["office@rapid.example", "info@homeinsulationvictoria.com.au"]);
    expect(await sendGoEmail("J1", "on_day_630am", NO)).toBe("already sent");
    expect(testMail).toHaveLength(3);
    expect(office).toHaveLength(0); expect(alerts).toHaveLength(0);
  });
  test("real + approved but trade messages paused / comms off / sender blocked: held once, nothing claimed, retried next time", async () => {
    paused = "Trade messages paused";
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("held: Trade messages paused");
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("held: Trade messages paused");
    expect(events("go_email_held")).toHaveLength(1);
    expect(events("go_email_sent")).toHaveLength(0);
    expect(office).toHaveLength(0); expect(alerts).toHaveLength(0);
    paused = null; commsOn = false;
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("held: customer communications are off");
    commsOn = true; officeResult = { status: "blocked", detail: "Emails are paused" };
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("held: Emails are paused");
    expect(events("go_email_sent")).toHaveLength(0);
    officeResult = { status: "sent", detail: "ok" };
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toMatch(/^sent/);
    expect(events("go_email_sent")).toHaveLength(2); // office + info@
  });
  test("no installer office email / TEST delivery held / deleted job: nothing sent, a reason returned", async () => {
    tables["businesses"]![0]!["email"] = "";
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("skipped: installer business has no office email");
    tables["businesses"]![0]!["email"] = "office@rapid.example"; qaHeld = true;
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("skipped: TEST delivery held");
    qaHeld = false; tables["jobs"]![0]!["deleted_at"] = "2026-11-01T00:00:00Z";
    expect(await sendGoEmail("J1", "day_before_2pm", NO, { approved: true })).toBe("skipped: job not found");
    expect(office).toHaveLength(0); expect(alerts).toHaveLength(0); expect(testMail).toHaveLength(0);
  });
});

describe("runPrestart calls sendGoEmail after a slot run (wiring pinned by source)", () => {
  test("prestart.server hands a slot result to go-email.server; never for office/esc triggers", async () => {
    const src = await Bun.file(new URL("../src/lib/prestart.server.ts", import.meta.url)).text();
    expect(src).toContain('import("./go-email.server")');
    expect(src).toMatch(/if \(slot\)[\s\S]*sendGoEmail\(jobId, slot/);
  });
});
