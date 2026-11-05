// Deep Part 5a (Jo 4–5 Nov 2026): no Lead Installer picked 3 days before the install → ONE email to the partner's office
// ("Pick the Lead Installer …", DRAFT behind LEAD_INSTALLER_REMINDER_APPROVED, held + recorded once for real offices,
// TEST → test-send); still none 2 days before (the lock) → ONE red Needs me row for the Home Insulation Victoria office
// ("No Lead Installer: HV-… install …"), cleared once a Lead Installer is picked. Every installer business, own customers
// and Home Insulation Victoria leads alike. Replaces the 2 Nov 9am "Confirm or change your Lead Installer by 5pm" email.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  LEAD_INSTALLER_REMINDER_APPROVED, LEAD_REMINDER_EVENT, LEAD_REMINDER_FLAG_EVENT, LEAD_REMINDER_HELD_EVENT, LEAD_REMINDER_TEXT,
  leadReminderDue, leadReminderInstallYmd, leadReminderKey, noLeadInstallerLine, openNoLeadInstallerFlags, renderLeadInstallerReminder,
} from "../src/lib/lead-installer-reminder.core";
import { leadInstallerLock } from "../src/lib/prestart.core";

const START = "2026-11-12T20:30:00Z"; // Fri 13 Nov 2026 7:30am Melbourne (AEDT)
const at = (iso: string) => new Date(iso);
// Tue 10 Nov 7:29/7:30am AEDT (= 20:29/20:30Z Mon 9 Nov); Wed 11 Nov 7:29/7:30am (= 20:29/20:30Z Tue 10 Nov).
const TUE_0729 = "2026-11-09T20:29:00Z", TUE_0730 = "2026-11-09T20:30:00Z", TUE_1200 = "2026-11-10T01:00:00Z", WED_0729 = "2026-11-10T20:29:00Z", WED_0730 = "2026-11-10T20:30:00Z", THU_0900 = "2026-11-11T22:00:00Z";

describe("timing: email from 3 days before, flag from 2 days before (the lock), nothing once the install started", () => {
  test("reminder window", () => {
    expect(leadReminderDue({ startIso: START, now: at(TUE_0729) })).toBe("wait");
    expect(leadReminderDue({ startIso: START, now: at(TUE_0730) })).toBe("remind");
    expect(leadReminderDue({ startIso: START, now: at(TUE_1200) })).toBe("remind");
    expect(leadReminderDue({ startIso: START, now: at(WED_0729) })).toBe("remind");
    expect(leadReminderDue({ startIso: START, now: at(WED_0730) })).toBe("flag");
    expect(leadReminderDue({ startIso: START, now: at(THU_0900) })).toBe("flag");
    expect(leadReminderDue({ startIso: START, now: at(START) })).toBe("too_late");
  });
  test("DST: Mon 5 Oct 8am AEDT install → remind from Fri 2 Oct 8am AEST, flag from Sat 3 Oct 8am AEST", () => {
    const start = "2026-10-04T21:00:00Z";
    expect(leadReminderDue({ startIso: start, now: at("2026-10-01T21:59:00Z") })).toBe("wait");
    expect(leadReminderDue({ startIso: start, now: at("2026-10-01T22:00:00Z") })).toBe("remind");
    expect(leadReminderDue({ startIso: start, now: at("2026-10-02T21:59:00Z") })).toBe("remind");
    expect(leadReminderDue({ startIso: start, now: at("2026-10-02T22:00:00Z") })).toBe("flag");
  });
  test("keys are per job + install day; a moved install gets a new key", () => {
    expect(leadReminderInstallYmd(START)).toBe("2026-11-13");
    expect(leadReminderKey("J1", "2026-11-13")).toBe("lead-reminder:v1:J1:2026-11-13");
    expect(leadReminderKey("J1", leadReminderInstallYmd("2026-11-15T20:30:00Z"))).toBe("lead-reminder:v1:J1:2026-11-16");
  });
  test("the template starts OFF; event names", () => {
    expect(LEAD_INSTALLER_REMINDER_APPROVED).toBe(false);
    expect(LEAD_REMINDER_EVENT).toBe("lead_installer_reminder_email");
    expect(LEAD_REMINDER_HELD_EVENT).toBe("lead_installer_reminder_held");
    expect(LEAD_REMINDER_FLAG_EVENT).toBe("no_lead_installer");
  });
});

describe("wording (Jo-style, plain)", () => {
  const mail = renderLeadInstallerReminder({ jobNumber: "HV-1234", address: "12 Example St, Box Hill 3128", startIso: START, jobUrl: "https://p/field/day/J1", lockLabel: leadInstallerLock(START).lockLabel });
  test("subject and body", () => {
    expect(mail.subject).toBe("Pick the Lead Installer for 12 Example St, Box Hill 3128 on Fri 13 Nov");
    expect(mail.text).toContain("Hi, 12 Example St, Box Hill 3128 is booked for install on Fri 13 Nov, 7:30am but no Lead Installer is picked yet. Pick one on the job page in the portal by Wed 11 Nov, 7:30am so we can lodge it with the ESC. Jo");
    expect(mail.text).toContain("https://p/field/day/J1");
    expect(mail.html).toContain("Pick the Lead Installer");
    expect(LEAD_REMINDER_TEXT.button).toBe("Pick the Lead Installer");
  });
  test("never 'lead installer' in lowercase, never HIV, never 'fixes'", () => {
    for (const s of [mail.subject, mail.text, mail.html]) {
      expect(s).not.toMatch(/lead installer/);
      expect(s).not.toMatch(/\bHIV\b|\bfixes\b/);
    }
  });
  test("the Needs me line", () => {
    expect(noLeadInstallerLine("HV-1234", START)).toBe("No Lead Installer: HV-1234 install Fri 13 Nov");
  });
  test("open flags = flag minus cleared per key, newest per job, only needs_office rows with a booking and a line", () => {
    const ev = (job_id: string, event_type: string, created_at: string, details: Record<string, unknown>) => ({ job_id, event_type, created_at, details });
    const rows = [
      ev("J1", LEAD_REMINDER_FLAG_EVENT, "2026-11-10T20:30:00Z", { key: "k1", booking_id: "BK1", line: "No Lead Installer: HV-1 install Fri 13 Nov", needs_office: true }),
      ev("J1", LEAD_REMINDER_FLAG_EVENT, "2026-11-01T20:30:00Z", { key: "k0", booking_id: "BK0", line: "old", needs_office: true }),
      ev("J2", LEAD_REMINDER_FLAG_EVENT, "2026-11-10T20:30:00Z", { key: "k2", booking_id: "BK2", line: "No Lead Installer: HV-2 install Fri 13 Nov", needs_office: true }),
      ev("J2", "no_lead_installer_cleared", "2026-11-10T22:00:00Z", { key: "k2" }),
      ev("J3", LEAD_REMINDER_FLAG_EVENT, "2026-11-10T20:30:00Z", { key: "k3", booking_id: "BK3", line: "x" }),
    ];
    expect(openNoLeadInstallerFlags(rows)).toEqual([{ jobId: "J1", key: "k1", bookingId: "BK1", at: "2026-11-10T20:30:00Z", line: "No Lead Installer: HV-1 install Fri 13 Nov" }]);
  });
});

// ── server: sweep, in-memory PostgREST ───────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
function from(t: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" = "select";
  let inserted: Row | null = null;
  let order: { col: string; asc: boolean } | null = null;
  let range: [number, number] | null = null;
  const res = () => {
    if (op === "insert") return { data: inserted ? { id: inserted["id"] } : null, error: null };
    let rows = (tables[t] ?? []).filter((x) => filters.every((f) => f(x)));
    if (order) rows = [...rows].sort((a, b) => String(a[order!.col] ?? "").localeCompare(String(b[order!.col] ?? "")) * (order!.asc ? 1 : -1));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    return { data: rows, error: null };
  };
  const one = async () => { const r = res(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push((r) => String(r[k]) <= v); return q; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] as Row | undefined)?.[kk] === vv)); return q; },
    order: (col: string, o?: { ascending?: boolean }) => { order = { col, asc: o?.ascending !== false }; return q; },
    range: (a: number, b: number) => { range = [a, b]; return q; },
    not: () => q, gt: () => q, lt: () => q, or: () => q, limit: () => q,
    insert: (r: Row) => { op = "insert"; inserted = { id: crypto.randomUUID(), ...r }; (tables[t] ??= []).push(inserted); return q; },
    maybeSingle: one, single: one,
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, bad),
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("../src/lib/job-facts.server", () => ({ jobAdmin: { from } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, event_type, summary, details, created_at: new Date().toISOString() }); },
}));
let paused: string | null = null;
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => paused }));
const office: { to: string; subject: string; key: string | undefined }[] = [];
let officeResult: { status: string; detail: string } = { status: "sent", detail: "faked" };
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { to: string; subject: string; idempotencyKey?: string }) => { office.push({ to: p.to, subject: p.subject, key: p.idempotencyKey }); return officeResult; } }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn }));
const testMail: { to: string; subject: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({ TEST_APP_BASE: "https://test.p", sendTestEmail: async (_c: unknown, to: string, subject: string) => { testMail.push({ to, subject }); return { status: "sent", detail: "test" }; } }));
mock.module("../src/lib/set-password-link.core", () => ({ SET_PASSWORD_BASE: "https://p" }));

const { sweepLeadInstallerReminder } = await import("../src/lib/lead-installer-reminder.server");
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);
const SUBJECT = "Pick the Lead Installer for 12 Example St, Box Hill 3128 on Fri 13 Nov";

beforeEach(() => {
  office.length = 0; testMail.length = 0; paused = null; commsOn = true; officeResult = { status: "sent", detail: "faked" };
  tables = {
    bookings: [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: "2026-11-09T00:00:00Z" }],
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website", deleted_at: null, stage: "installation_booked", installation_completed_at: null, properties: { address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Rapid Insulation", email: "Office@Rapid.example", onboarding_notes: null }],
    workflow_events: [],
  };
});
const pickLead = (when = "2026-11-10T00:00:00Z") => tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: "J1", event_type: "visit_allocated", created_at: when, details: { visit: "install", worker_id: "w1" } });

describe("sweepLeadInstallerReminder", () => {
  test("flag false (the code): a real office is held and recorded once, nothing sent; a second sweep adds nothing", async () => {
    expect(await sweepLeadInstallerReminder(at(TUE_0730))).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(await sweepLeadInstallerReminder(at(TUE_1200))).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(office).toHaveLength(0); expect(testMail).toHaveLength(0);
    expect(events(LEAD_REMINDER_HELD_EVENT)).toHaveLength(1);
    expect(events(LEAD_REMINDER_HELD_EVENT)[0]!["details"]).toMatchObject({ key: "lead-reminder:v1:J1:2026-11-13", reason: "wording not approved yet" });
    expect(events(LEAD_REMINDER_EVENT)).toHaveLength(0);
  });
  test("approved (overridden): one email 3 days before with the key; nothing new the same day; nothing before the window", async () => {
    expect(await sweepLeadInstallerReminder(at(TUE_0729), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0, flagged: 0 });
    expect(office).toEqual([{ to: "office@rapid.example", subject: SUBJECT, key: "lead-reminder:v1:J1:2026-11-13" }]);
    expect(events(LEAD_REMINDER_EVENT)[0]!["details"]).toMatchObject({ key: "lead-reminder:v1:J1:2026-11-13", install_date: "2026-11-13", booking_id: "BK1", test: false });
    expect(await sweepLeadInstallerReminder(at(TUE_1200), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(office).toHaveLength(1);
  });
  test("a Lead Installer already picked: no email, no flag, nothing recorded", async () => {
    pickLead();
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(await sweepLeadInstallerReminder(at(WED_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(office).toHaveLength(0);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] !== "visit_allocated")).toHaveLength(0);
  });
  test("the Lead saved on the crew picker counts too", async () => {
    tables["workflow_events"]!.push({ id: "e2", job_id: "J1", event_type: "piisa_crew_selected", created_at: "2026-11-09T01:00:01Z", details: { selection: { lead: "w1", additional: [] } } });
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
  });
  test("2 days before, still no Lead Installer: ONE red office row (needs_office) per job + install day, plus the email if it never went", async () => {
    expect(await sweepLeadInstallerReminder(at(WED_0730), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0, flagged: 1 });
    expect(await sweepLeadInstallerReminder(at(THU_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    const flags = events(LEAD_REMINDER_FLAG_EVENT);
    expect(flags).toHaveLength(1);
    expect(flags[0]!["details"]).toMatchObject({ key: "lead-reminder:v1:J1:2026-11-13", booking_id: "BK1", start: START, needs_office: true, line: "No Lead Installer: HV-1234 install Fri 13 Nov" });
    expect(flags[0]!["summary"]).toBe("No Lead Installer: HV-1234 install Fri 13 Nov");
  });
  test("the flag clears (one cleared event) once a Lead Installer is picked; it never re-raises for the same install day", async () => {
    await sweepLeadInstallerReminder(at(WED_0730), { approved: true });
    pickLead("2026-11-10T22:00:00Z");
    expect(await sweepLeadInstallerReminder(at(THU_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(events("no_lead_installer_cleared")).toHaveLength(1);
    expect(events("no_lead_installer_cleared")[0]!["details"]).toMatchObject({ key: "lead-reminder:v1:J1:2026-11-13" });
    expect(await sweepLeadInstallerReminder(at("2026-11-12T00:00:00Z"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(events("no_lead_installer_cleared")).toHaveLength(1);
  });
  test("moved to Mon 16 Nov: new key, remind from Fri 13 Nov 7:30am; the 13 Nov record doesn't block it", async () => {
    await sweepLeadInstallerReminder(at(TUE_0730), { approved: true });
    tables["bookings"]![0]!["scheduled_start"] = "2026-11-15T20:30:00Z";
    expect(await sweepLeadInstallerReminder(at("2026-11-12T20:29:00Z"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    expect(await sweepLeadInstallerReminder(at("2026-11-12T20:30:00Z"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0, flagged: 0 });
    expect(office.map((o) => o.key)).toEqual(["lead-reminder:v1:J1:2026-11-13", "lead-reminder:v1:J1:2026-11-16"]);
  });
  test("TEST job → the test sender even with the flag off; trade pause → held once", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    expect(await sweepLeadInstallerReminder(at(TUE_0730))).toEqual({ checked: 1, sent: 1, held: 0, flagged: 0 });
    expect(testMail).toEqual([{ to: "office@rapid.example", subject: SUBJECT }]);
    expect(office).toHaveLength(0);
    tables["jobs"]![0]!["source"] = "website"; tables["workflow_events"] = tables["workflow_events"]!.filter((e) => e["event_type"] !== LEAD_REMINDER_EVENT);
    paused = "Trade messages paused";
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(await sweepLeadInstallerReminder(at(TUE_1200), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(events(LEAD_REMINDER_HELD_EVENT).filter((e) => (e["details"] as Row)["reason"] === "Trade messages paused")).toHaveLength(1);
    expect(office).toHaveLength(0);
  });
  test("customer comms off → held once, key not claimed; a failed send claims nothing and is retried with the same Idempotency-Key", async () => {
    commsOn = false;
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(events(LEAD_REMINDER_EVENT)).toHaveLength(0);
    commsOn = true; officeResult = { status: "failed", detail: "Couldn't reach the email service" };
    expect(await sweepLeadInstallerReminder(at(TUE_1200), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(office).toHaveLength(1);
    expect(events(LEAD_REMINDER_EVENT)).toHaveLength(0);
    officeResult = { status: "sent", detail: "faked" };
    expect(await sweepLeadInstallerReminder(at(WED_0729), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0, flagged: 0 });
    expect(office.map((o) => o.key)).toEqual(["lead-reminder:v1:J1:2026-11-13", "lead-reminder:v1:J1:2026-11-13"]);
    expect(events(LEAD_REMINDER_EVENT)).toHaveLength(1);
  });
  test("a completed install, a cancelled job or no office email: nothing goes", async () => {
    tables["jobs"]![0]!["installation_completed_at"] = "2026-11-13T05:00:00Z";
    expect(await sweepLeadInstallerReminder(at(WED_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    tables["jobs"]![0]!["installation_completed_at"] = null; tables["jobs"]![0]!["stage"] = "cancelled";
    expect(await sweepLeadInstallerReminder(at(WED_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0, flagged: 0 });
    tables["jobs"]![0]!["stage"] = "installation_booked"; tables["businesses"]![0]!["email"] = null;
    expect(await sweepLeadInstallerReminder(at(TUE_0730), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1, flagged: 0 });
    expect(events(LEAD_REMINDER_HELD_EVENT)[0]!["details"]).toMatchObject({ reason: "installer business has no office email" });
  });
  test("no double email: the retired 9am 'Confirm or change your Lead Installer' sweep is gone from the tick; only the reminder runs", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepLeadInstallerReminder");
    expect(tick).not.toContain("sweepLeadInstallerConfirm");
    expect(readFileSync("src/lib/lead-installer-confirm.server.ts", "utf8")).not.toContain("sweepLeadInstallerConfirm");
    expect(readFileSync("src/lib/lead-installer-reminder.server.ts", "utf8")).toContain(".range(from, from + PAGE - 1)");
  });
});
