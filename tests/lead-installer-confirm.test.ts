// Part 7 Task 6 (Jo 2 Nov 2026, "Lead Installer / ESC 24h rule"): ONE office email at 9am two days before the install —
// "Confirm or change your Lead Installer by 5pm today" — and from 5pm that day the Lead Installer (and the install day)
// is locked on every writer. Wording is DRAFT behind LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED (false): real offices are
// held and recorded once; TEST → test-send. The clock is Part 9's rule in prestart.core.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAD_CONFIRM_TEXT, LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED, leadConfirmDue, leadConfirmInstallYmd, leadConfirmKey, renderLeadInstallerConfirm } from "../src/lib/lead-installer-confirm.core";
import { LEAD_LOCKED_MESSAGE, leadInstallerLock, leadInstallerLocked } from "../src/lib/prestart.core";
import { leadLockBlocker } from "../src/lib/visit-allocation.core";

const START = "2026-11-12T20:30:00Z"; // Fri 13 Nov 2026 7:30am Melbourne (AEDT)
const BOOKED = "2026-11-09T00:00:00Z"; // Mon 9 Nov
const at = (iso: string) => new Date(iso);
// Wed 11 Nov Melbourne (AEDT = UTC+11): 8:59am = 21:59Z the day before, 9:00 = 22:00Z, 4:59pm = 05:59Z, 5pm = 06:00Z.
const WED_0859 = "2026-11-10T21:59:00Z", WED_0900 = "2026-11-10T22:00:00Z", WED_1100 = "2026-11-11T00:00:00Z", WED_1659 = "2026-11-11T05:59:00Z", WED_1700 = "2026-11-11T06:00:00Z", WED_1800 = "2026-11-11T07:00:00Z";

describe("Part 9's clock (prestart.core): 9am email, 5pm lock, two days before", () => {
  test("instants and label", () => {
    // Part 9 Task 9 (owner of the rule): lockLabel is the approved Part 5 screen format "Wed 11 Nov, 5pm".
    expect(leadInstallerLock(START)).toEqual({ emailAt: "2026-11-10T22:00:00.000Z", lockAt: "2026-11-11T06:00:00.000Z", lockLabel: "Wed 11 Nov, 5pm" });
    expect(leadInstallerLocked(START, at(WED_1659))).toBe(false);
    expect(leadInstallerLocked(START, at(WED_1700))).toBe(true);
    expect(LEAD_LOCKED_MESSAGE).toBe("Locked: ESC has been told. Email us to move this install.");
  });
  test("DST: install Tue 6 Oct 2026 8am → email Sun 4 Oct 9:00 AEDT", () => {
    expect(leadInstallerLock("2026-10-05T21:00:00Z").emailAt).toBe("2026-10-03T22:00:00.000Z");
    expect(leadInstallerLock("2026-10-05T21:00:00Z").lockAt).toBe("2026-10-04T06:00:00.000Z");
  });
});

describe("leadConfirmDue and the key", () => {
  test("wait before 9am, send from 9am until 5pm, too late from 5pm", () => {
    expect(leadConfirmDue({ startIso: START, bookedAt: BOOKED, now: at(WED_0859) })).toBe("wait");
    expect(leadConfirmDue({ startIso: START, bookedAt: BOOKED, now: at(WED_0900) })).toBe("send");
    expect(leadConfirmDue({ startIso: START, bookedAt: BOOKED, now: at(WED_1659) })).toBe("send");
    expect(leadConfirmDue({ startIso: START, bookedAt: BOOKED, now: at(WED_1700) })).toBe("too_late");
  });
  test("booked after 9am that day → send straight away; booked after 5pm → too late (already locked)", () => {
    expect(leadConfirmDue({ startIso: START, bookedAt: WED_1100, now: at(WED_1100) })).toBe("send");
    expect(leadConfirmDue({ startIso: START, bookedAt: WED_1100, now: at("2026-11-10T23:30:00Z") })).toBe("wait"); // 10:30am, not booked yet
    expect(leadConfirmDue({ startIso: START, bookedAt: WED_1800, now: at(WED_1800) })).toBe("too_late");
    expect(leadInstallerLocked(START, at(WED_1800))).toBe(true);
  });
  test("the key is per job + install Melbourne day; a moved install gets a new key and its own 9am", () => {
    expect(leadConfirmKey("J1", leadConfirmInstallYmd(START))).toBe("lead-confirm:v1:J1:2026-11-13");
    const MOVED = "2026-11-15T20:30:00Z"; // Mon 16 Nov 7:30am
    expect(leadConfirmKey("J1", leadConfirmInstallYmd(MOVED))).toBe("lead-confirm:v1:J1:2026-11-16");
    expect(leadInstallerLock(MOVED).emailAt).toBe("2026-11-13T22:00:00.000Z"); // Sat 14 Nov 9am
  });
});

describe("the rendered email (DRAFT)", () => {
  const mail = renderLeadInstallerConfirm({ jobNumber: "HV-1234", owner: "Sarah Brown", startIso: START, address: "12 Example St, Box Hill VIC 3128", lead: "John Smith", crew: ["Sam Lee", "Ali Khan"], jobUrl: "https://p/field/J1", lockLabel: leadInstallerLock(START).lockLabel });
  test("heading, rows, button and the 5pm line; never lowercase lead installer", () => {
    expect(mail.subject).toBe("HV-1234: Confirm or change your Lead Installer by 5pm today");
    for (const s of ["Confirm or change your Lead Installer by 5pm today", "Fri 13 Nov, 7:30am", "Lead Installer", "John Smith", "Crew", "Sam Lee, Ali Khan", "12 Example St, Box Hill VIC 3128", "https://p/field/J1", LEAD_CONFIRM_TEXT.button, LEAD_CONFIRM_TEXT.lockLine]) {
      expect(mail.html, s).toContain(s); expect(mail.text, s).toContain(s);
    }
    expect(mail.html).not.toMatch(/lead installer/);
    expect(mail.text).not.toMatch(/lead installer/);
    expect(mail.html).not.toMatch(/\bHIV\b/);
    expect(LEAD_INSTALLER_CONFIRM_EMAIL_APPROVED).toBe(false);
  });
  test("no Lead or crew picked yet reads plainly", () => {
    const m = renderLeadInstallerConfirm({ jobNumber: "HV-1", owner: "", startIso: START, address: "1 Test St", lead: null, crew: [], jobUrl: "https://p/field/J1", lockLabel: "5pm Wed 11 Nov" });
    expect(m.text).toContain(`Lead Installer: ${LEAD_CONFIRM_TEXT.noLead}`);
    expect(m.text).toContain(`Crew: ${LEAD_CONFIRM_TEXT.noCrew}`);
  });
});

describe("leadLockBlocker (the crew writers' rule)", () => {
  test("refuses only a different Lead after the lock; crew-only, first Lead, same Lead, no booking never refused", () => {
    expect(leadLockBlocker({ startIso: START, now: at(WED_1700), currentLeadId: "w1", newLeadId: "w2" })).toBe(LEAD_LOCKED_MESSAGE);
    expect(leadLockBlocker({ startIso: START, now: at(WED_1659), currentLeadId: "w1", newLeadId: "w2" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_1700), currentLeadId: "w1", newLeadId: "w1" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_1700), currentLeadId: null, newLeadId: "w2" })).toBeNull();
    expect(leadLockBlocker({ startIso: START, now: at(WED_1700), currentLeadId: "w1", newLeadId: null })).toBeNull();
    expect(leadLockBlocker({ startIso: null, now: at(WED_1700), currentLeadId: "w1", newLeadId: "w2" })).toBeNull();
  });
});

// ── server: sweep + writers' lock, in-memory PostgREST ───────────────────────────────────────────────────────────
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

const { sweepLeadInstallerConfirm, assertLeadInstallerUnlocked, leadInstallerLockState } = await import("../src/lib/lead-installer-confirm.server");
const events = (type: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === type);

beforeEach(() => {
  office.length = 0; testMail.length = 0; paused = null; commsOn = true; officeResult = { status: "sent", detail: "faked" };
  tables = {
    bookings: [{ id: "BK1", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: BOOKED }],
    jobs: [{ id: "J1", job_number: "HV-1234", source: "website", deleted_at: null, owners: { full_name: "Sarah Brown" }, properties: { address_line: "12 Example St", suburb: "Box Hill", postcode: "3128" } }],
    job_assignments: [{ job_id: "J1", role: "installer", active: true, business_id: "B1" }],
    businesses: [{ id: "B1", name: "Rapid Insulation", email: "Office@Rapid.example", onboarding_notes: null }],
    partner_workers: [{ id: "w1", full_legal_name: "John Smith" }, { id: "w2", full_legal_name: "Sam Lee" }, { id: "w3", full_legal_name: "Ali Khan" }],
    workflow_events: [
      { id: "e1", job_id: "J1", event_type: "visit_allocated", created_at: "2026-11-09T01:00:00Z", details: { visit: "install", worker_id: "w1" } },
      { id: "e2", job_id: "J1", event_type: "piisa_crew_selected", created_at: "2026-11-09T01:00:01Z", details: { selection: { lead: "w1", additional: [{ workerId: "w2" }, { workerId: "w3" }] } } },
    ],
  };
});

describe("sweepLeadInstallerConfirm", () => {
  test("flag false (the code): a real office is held and recorded once, nothing sent; a second sweep adds nothing", async () => {
    expect(await sweepLeadInstallerConfirm(at(WED_0900))).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await sweepLeadInstallerConfirm(at(WED_1100))).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(office).toHaveLength(0); expect(testMail).toHaveLength(0);
    expect(events("lead_installer_confirm_held")).toHaveLength(1);
    expect(events("lead_installer_confirm_held")[0]!["details"]).toMatchObject({ key: "lead-confirm:v1:J1:2026-11-13", reason: "wording not approved yet" });
    expect(events("lead_installer_confirm_email")).toHaveLength(0); // the key is not claimed by a hold
  });
  test("approved (overridden): one email to the installer office at 9am with the key; a second sweep the same day sends nothing new", async () => {
    expect(await sweepLeadInstallerConfirm(at(WED_0859), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(await sweepLeadInstallerConfirm(at(WED_0900), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(office).toEqual([{ to: "office@rapid.example", subject: "HV-1234: Confirm or change your Lead Installer by 5pm today", key: "lead-confirm:v1:J1:2026-11-13" }]);
    expect(events("lead_installer_confirm_email")).toHaveLength(1);
    expect(events("lead_installer_confirm_email")[0]!["details"]).toMatchObject({ key: "lead-confirm:v1:J1:2026-11-13", install_date: "2026-11-13", booking_id: "BK1", lead_worker_id: "w1", test: false });
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(office).toHaveLength(1);
  });
  test("after 5pm nothing goes (too late); booked after 5pm never gets one", async () => {
    expect(await sweepLeadInstallerConfirm(at(WED_1700), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    tables["bookings"]![0]!["created_at"] = WED_1800;
    expect(await sweepLeadInstallerConfirm(at(WED_1800), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(office).toHaveLength(0);
  });
  test("moved to Mon 16 Nov: new key, due Sat 14 Nov 9am; the 13 Nov record doesn't block it", async () => {
    await sweepLeadInstallerConfirm(at(WED_0900), { approved: true });
    tables["bookings"]![0]!["scheduled_start"] = "2026-11-15T20:30:00Z";
    expect(await sweepLeadInstallerConfirm(at("2026-11-13T21:00:00Z"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 }); // Sat 8am: wait
    expect(await sweepLeadInstallerConfirm(at("2026-11-13T22:00:00Z"), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 }); // Sat 9am
    expect(office.map((o) => o.key)).toEqual(["lead-confirm:v1:J1:2026-11-13", "lead-confirm:v1:J1:2026-11-16"]);
    expect(await sweepLeadInstallerConfirm(at("2026-11-14T00:00:00Z"), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
  });
  test("TEST job → the test sender even with the flag off; trade pause → held once", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    expect(await sweepLeadInstallerConfirm(at(WED_0900))).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(testMail).toEqual([{ to: "office@rapid.example", subject: "HV-1234: Confirm or change your Lead Installer by 5pm today" }]);
    expect(office).toHaveLength(0);
    tables["jobs"]![0]!["source"] = "website"; tables["workflow_events"] = tables["workflow_events"]!.filter((e) => e["event_type"] !== "lead_installer_confirm_email");
    paused = "Trade messages paused";
    expect(await sweepLeadInstallerConfirm(at(WED_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(events("lead_installer_confirm_held").filter((e) => (e["details"] as Row)["reason"] === "Trade messages paused")).toHaveLength(1);
    expect(office).toHaveLength(0);
  });
  test("fix I1: customer comms off → held once, key not claimed, nothing sent; sends once comms are on", async () => {
    commsOn = false;
    expect(await sweepLeadInstallerConfirm(at(WED_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(office).toHaveLength(0);
    expect(events("lead_installer_confirm_held")).toHaveLength(1);
    expect(events("lead_installer_confirm_held")[0]!["details"]).toMatchObject({ key: "lead-confirm:v1:J1:2026-11-13", reason: "customer communications are off" });
    expect(events("lead_installer_confirm_email")).toHaveLength(0);
    commsOn = true;
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(office).toHaveLength(1);
    expect(events("lead_installer_confirm_email")).toHaveLength(1);
  });
  test("fix I1: a failed send claims nothing and is retried next tick; the claim is written only after a sent result", async () => {
    officeResult = { status: "failed", detail: "Couldn't reach the email service" };
    expect(await sweepLeadInstallerConfirm(at(WED_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(office).toHaveLength(1);
    expect(events("lead_installer_confirm_email")).toHaveLength(0);
    expect(events("lead_installer_confirm_held")).toHaveLength(1);
    expect(events("lead_installer_confirm_held")[0]!["details"]).toMatchObject({ key: "lead-confirm:v1:J1:2026-11-13", reason: "send failed: Couldn't reach the email service" });
    officeResult = { status: "sent", detail: "faked" };
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 1, held: 0 });
    expect(office).toHaveLength(2);
    expect(office.map((o) => o.key)).toEqual(["lead-confirm:v1:J1:2026-11-13", "lead-confirm:v1:J1:2026-11-13"]); // same Idempotency-Key guards a double send
    expect(events("lead_installer_confirm_email")).toHaveLength(1);
    expect(await sweepLeadInstallerConfirm(at(WED_1659), { approved: true })).toEqual({ checked: 1, sent: 0, held: 0 });
    expect(office).toHaveLength(2);
  });
  test("fix I1: a blocked send (sender's own hold) claims nothing and records the hold once", async () => {
    officeResult = { status: "blocked", detail: "Emails are paused" };
    expect(await sweepLeadInstallerConfirm(at(WED_0900), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(await sweepLeadInstallerConfirm(at(WED_1100), { approved: true })).toEqual({ checked: 1, sent: 0, held: 1 });
    expect(events("lead_installer_confirm_email")).toHaveLength(0);
    expect(events("lead_installer_confirm_held")).toHaveLength(1);
    expect(events("lead_installer_confirm_held")[0]!["details"]).toMatchObject({ reason: "Emails are paused" });
    const src = readFileSync("src/lib/lead-installer-confirm.server.ts", "utf8");
    expect(src).toContain('if (r.status !== "sent") return hold(');
  });
  test("every installer, not only in-house; the email lists the Lead and crew by name", async () => {
    await sweepLeadInstallerConfirm(at(WED_0900), { approved: true });
    expect(office).toHaveLength(1);
    const src = readFileSync("src/lib/lead-installer-confirm.server.ts", "utf8");
    expect(src).not.toContain("readInHouseDispatchState");
    expect(src).toContain(".range(from, from + PAGE - 1)");
  });
});

describe("the 5pm lock on the writers (server check, current booking read fresh)", () => {
  test("after lockAt: a different Lead or a moved start is refused with LEAD_LOCKED_MESSAGE; same Lead / same start / crew-only pass", async () => {
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2" }, at(WED_1700))).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    await expect(assertLeadInstallerUnlocked("J1", { newStart: "2026-11-13T20:30:00Z" }, at(WED_1700))).rejects.toThrow(LEAD_LOCKED_MESSAGE);
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w1", newStart: START }, at(WED_1700))).resolves.toBeUndefined();
    await expect(assertLeadInstallerUnlocked("J1", {}, at(WED_1700))).resolves.toBeUndefined();
    expect(await leadInstallerLockState("J1", at(WED_1700))).toEqual({ locked: true, start: START, bookingId: "BK1", leadId: "w1" });
  });
  test("before lockAt everything passes; no confirmed install booking → never locked", async () => {
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2", newStart: "2026-11-13T20:30:00Z" }, at(WED_1659))).resolves.toBeUndefined();
    tables["bookings"] = [];
    await expect(assertLeadInstallerUnlocked("J1", { newLeadId: "w2" }, at(WED_1700))).resolves.toBeUndefined();
    expect((await leadInstallerLockState("J1", at(WED_1700))).locked).toBe(false);
  });
  test("the current install booking is the latest-scheduled non-cancelled one (shared helper); a cancelled later booking or a completed one never locks", async () => {
    tables["bookings"]!.push({ id: "BK2", job_id: "J1", kind: "installation", status: "cancelled", scheduled_start: "2026-11-20T20:30:00Z", created_at: WED_1100 });
    expect(await leadInstallerLockState("J1", at(WED_1700))).toMatchObject({ locked: true, bookingId: "BK1" });
    tables["bookings"]!.push({ id: "BK3", job_id: "J1", kind: "installation", status: "confirmed", scheduled_start: "2026-11-25T20:30:00Z", created_at: BOOKED });
    expect(await leadInstallerLockState("J1", at(WED_1700))).toMatchObject({ locked: false, bookingId: "BK3" }); // moved out: its own lock day
    tables["bookings"] = [{ id: "BK4", job_id: "J1", kind: "installation", status: "completed", scheduled_start: START, created_at: BOOKED }];
    expect((await leadInstallerLockState("J1", at(WED_1700))).locked).toBe(false);
    for (const f of ["src/lib/lead-installer-confirm.server.ts", "src/lib/visit-allocation.server.ts", "src/lib/swms-link.server.ts", "src/lib/swms.server.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain('import("./install-booking.server")');
      expect(src, f).not.toMatch(/from\("bookings"\)\.select\("[^"]*scheduled_start[^"]*"\)\.eq\("job_id"/);
    }
  });
  test("the Lead is read from the saved crew when no allocation event exists", async () => {
    tables["workflow_events"] = tables["workflow_events"]!.filter((e) => e["event_type"] !== "visit_allocated");
    expect((await leadInstallerLockState("J1", at(WED_1700))).leadId).toBe("w1");
  });
  test("wiring: the four writers check the lock against the current booking inside the server", () => {
    const fns = readFileSync("src/lib/trade-view.functions.ts", "utf8");
    const change = fns.slice(fns.indexOf("export const changeInHouseLeadInstaller"), fns.indexOf("export const recordInHouseEscNoticeUpdated"));
    expect(change).toContain("assertLeadInstallerUnlocked(data.jobId,{newLeadId:data.workerId})");
    expect(change.indexOf("assertLeadInstallerUnlocked")).toBeLessThan(change.indexOf("saveCrewWithLead("));
    const tv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const book = tv.slice(tv.indexOf("export async function inHouseBookVisit"), tv.indexOf("export async function setMittiInvited"));
    expect(book).toContain("assertLeadInstallerUnlocked(input.jobId, { newStart: input.start, newLeadId: input.workerId ?? null })");
    expect(book.indexOf("assertLeadInstallerUnlocked")).toBeLessThan(book.indexOf("saveInHouseVisit("));
    const va = readFileSync("src/lib/visit-allocation.server.ts", "utf8");
    const save = va.slice(va.indexOf("export async function saveCrewWithLead("), va.indexOf("async function refuseLockedLeadChange"));
    expect(save).toContain("await refuseLockedLeadChange(jobId, leadWorkerId(sel));");
    expect(save.indexOf("refuseLockedLeadChange")).toBeLessThan(save.indexOf("readInHouseDispatchState"));
    expect(va).toContain("leadLockBlocker({ startIso: book.scheduled_start, now, currentLeadId");
    const alloc = va.slice(va.indexOf("export async function allocateVisit("), va.indexOf("export async function saveCrewWithLead("));
    expect(alloc).toContain('if (kind === "install") await refuseLockedLeadChange(jobId, workerId);'); // fix I2: fourth writer
    expect(alloc.indexOf("refuseLockedLeadChange")).toBeLessThan(alloc.indexOf("logEvent("));
    expect(readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8")).toContain("sweepLeadInstallerConfirm()");
  });
});
