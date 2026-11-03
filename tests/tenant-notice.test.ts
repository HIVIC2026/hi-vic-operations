// Part 4 Task 16 (cl 23; Jo 2 Nov 2026, answers 7 and 22): once the install day is booked (and whenever its time
// changes), the TENANT always gets the notice by text AND email: the date, the time, that the power will be off for the
// day, and the business name + office phone. Tenant details come from the owner's quick taps (Part 3 Task 19). It is a
// compliance send (the owner's Do not contact never blocks it; a STOP from the tenant's own number does). DRAFT wording,
// so every send stays behind TENANT_NOTICE_APPROVED = false.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  TENANT_NOTICE_APPROVED, TENANT_NOTICE_EMAIL_PURPOSE, TENANT_NOTICE_HELD_EVENT, TENANT_NOTICE_SENT_EVENT, TENANT_NOTICE_SMS_TYPE, tenantNotice, tenantNoticeHeldOpen,
  tenantNoticeKey, tenantNoticeNeeded,
} from "../src/lib/tenant-notice.core";
import { sendTenantNotice, type TenantNoticeDeps } from "../src/lib/tenant-notice.server";
import type { RentalAnswers } from "../src/lib/rental-answers.core";
import { COMPLIANCE_OWNER_EMAIL_PURPOSES, doNotContactBlocks } from "../src/lib/do-not-contact.core";
import { SMS_DO_NOT_CONTACT, SMS_FRESHNESS, SMS_MESSAGE_TYPES, SMS_REPLIED_STOP, smsBlocker } from "../src/lib/sms.core";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
import { buildNeedsRows, type NeedsFacts } from "../src/lib/office-needs.core";

const rapid = { name: "Rapid Insulation Pty Ltd", tradingName: "Rapid Insulation", officePhone: "03 9000 0000", email: "office@rapid.test" };
const ADDRESS = "12 Sample Street, Glen Waverley VIC 3150";
// Friday 13 November 2026, 7:30am Melbourne (AEDT = UTC+11).
const START = "2026-11-12T20:30:00Z";
const RENTED: RentalAnswers = { rented: true, tenant: { name: "Tina Lee", mobile: "+61400111222", email: "tina@example.com" }, access: { who: "property_manager", name: "Paul Manager", mobile: "+61400333444" } };
const OWNER_LIVES: RentalAnswers = { rented: false, tenant: null, access: null };

describe("tenant notice — pure rules (DRAFT wording)", () => {
  test("ships switched off; compliance purpose; its text type is an unapproved owner-side text with quiet hours", () => {
    expect(TENANT_NOTICE_APPROVED).toBe(false);
    expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).toContain(TENANT_NOTICE_EMAIL_PURPOSE);
    expect(doNotContactBlocks({ channel: "email", purpose: TENANT_NOTICE_EMAIL_PURPOSE, on: true })).toBeNull();
    const t = SMS_MESSAGE_TYPES[TENANT_NOTICE_SMS_TYPE];
    expect({ audience: t.audience, approved: t.wordingApproved, quiet: t.quietHours, side: t.ownerSideContact, purpose: t.compliancePurpose })
      .toEqual({ audience: "owner", approved: false, quiet: true, side: true, purpose: TENANT_NOTICE_EMAIL_PURPOSE });
    expect(SMS_FRESHNESS.tenant_notice).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
  });
  test("needed only when the owner answered rented", () => {
    expect(tenantNoticeNeeded(null)).toBe(false);
    expect(tenantNoticeNeeded(OWNER_LIVES)).toBe(false);
    expect(tenantNoticeNeeded(RENTED)).toBe(true);
    expect(tenantNoticeNeeded({ rented: true, tenant: null, access: null })).toBe(true); // rented but details missing → the sender holds
  });
  test("text and email carry the day, the time, the power-off line and the business name + office phone", () => {
    const n = tenantNotice({ firstName: "Tina", address: ADDRESS, startIso: START, business: rapid });
    expect("held" in n).toBe(false);
    const { sms, email } = n as Exclude<typeof n, { held: string }>;
    expect(sms).toBe("Home Insulation Victoria: Hi Tina, ceiling insulation is being installed at 12 Sample Street, Glen Waverley VIC 3150 on Fri 13 Nov, 7:30am. The power will be off for the day while they work in the ceiling. Questions? Call Rapid Insulation on 03 9000 0000.");
    for (const s of ["Fri 13 Nov", "7:30am", "power will be off for the day", "Rapid Insulation", "03 9000 0000", ADDRESS]) {
      expect({ s, inText: email.text.includes(s) }).toEqual({ s, inText: true });
      expect({ s, inHtml: email.html.includes(s) }).toEqual({ s, inHtml: true });
    }
    expect(email.subject).toBe("Ceiling insulation is being installed on Fri 13 Nov");
    expect(email.text).toContain("Hi Tina,");
    // Tenant-facing wording follows the owner rules: never money, consent, rebate paperwork, a worker's mobile, "HIV" or "lawyer".
    for (const bad of [/\$/, /deposit|balance|invoice|pay\b/i, /consent|rebate|VEEC/i, /\bHIV\b/, /lawyer/i, /04\d\d \d\d\d \d\d\d/]) expect({ bad: String(bad), sms: bad.test(sms), email: bad.test(email.text) }).toEqual({ bad: String(bad), sms: false, email: false });
    expect(tenantNotice({ firstName: null, address: ADDRESS, startIso: START, business: rapid })).toMatchObject({ sms: expect.stringContaining("Hi there,") });
  });
  test("no office phone → held (never a worker's mobile, never blank)", () => {
    expect(tenantNotice({ firstName: "Tina", address: ADDRESS, startIso: START, business: { ...rapid, officePhone: " " } })).toEqual({ held: "No office phone for Rapid Insulation" });
    // The email is not needed for the notice (the owner's "You're booked" email needs it; this one names the office phone only).
    expect("held" in tenantNotice({ firstName: "Tina", address: ADDRESS, startIso: START, business: { ...rapid, email: null } })).toBe(false);
  });
  test("keys: one notice per booking and channel; a new time is a new booking, so a new notice", () => {
    expect(tenantNoticeKey("b1", "sms")).toBe("tenant-notice:v1:b1:sms");
    expect(tenantNoticeKey("b1", "email")).toBe("tenant-notice:v1:b1:email");
  });
  test("the real sender: a STOP from the tenant's number blocks the text; the owner's Do not contact never does", () => {
    const base = { to: "+61400111222", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-03T03:00:00Z" };
    expect(smsBlocker({ ...base, type: TENANT_NOTICE_SMS_TYPE })).toBe("Wording not approved yet"); // DRAFT
    const types = SMS_MESSAGE_TYPES as unknown as Record<string, unknown>;
    const saved = types[TENANT_NOTICE_SMS_TYPE];
    types[TENANT_NOTICE_SMS_TYPE] = { ...SMS_MESSAGE_TYPES[TENANT_NOTICE_SMS_TYPE], wordingApproved: true };
    try {
      expect(smsBlocker({ ...base, type: TENANT_NOTICE_SMS_TYPE, doNotContact: true })).toBeNull();
      expect(smsBlocker({ ...base, type: TENANT_NOTICE_SMS_TYPE, optedOut: true })).toBe(SMS_REPLIED_STOP);
    } finally { types[TENANT_NOTICE_SMS_TYPE] = saved; }
    expect(smsBlocker({ ...base, type: "in_house_booked_owner", doNotContact: true })).toBe(SMS_DO_NOT_CONTACT);
    // The sender reads the owner consent the compliance way (an unsubscribe's not_granted row still lets it go).
    expect(readFileSync("src/lib/sms.server.ts", "utf8")).toContain("smsCompliancePurpose");
  });
  test("Needs me: a held notice for the current install booking is one row until a notice for that booking is sent", () => {
    const held = { event_type: TENANT_NOTICE_HELD_EVENT, created_at: "2026-11-02T00:00:00Z", details: { booking_id: "b1", reason: "no tenant details" } };
    const sent = { event_type: TENANT_NOTICE_SENT_EVENT, created_at: "2026-11-02T01:00:00Z", details: { booking_id: "b1" } };
    const current = [{ id: "b1", scheduled_start: START }];
    expect(tenantNoticeHeldOpen([held], current)).toEqual({ at: "2026-11-02T00:00:00Z", text: "Tenant not told the install day — no tenant details. Add the tenant's name, mobile and email on the job." });
    expect(tenantNoticeHeldOpen([held, sent], current)).toBeNull();
    expect(tenantNoticeHeldOpen([held], [{ id: "b2", scheduled_start: START }])).toBeNull(); // the booking moved: the new booking gets its own notice
    expect(tenantNoticeHeldOpen([held], [])).toBeNull();
    const facts: NeedsFacts = { jobId: "j1", jobNumber: "HV-1", surname: "Jones", suburb: null, tenantNoticeHeld: { at: "2026-11-02T00:00:00Z", text: "Tenant not told the install day — no tenant details. Add the tenant's name, mobile and email on the job." } };
    const rows = buildNeedsRows({ now: Date.parse("2026-11-03T00:00:00Z"), jobs: [facts] });
    const row = rows.today.find((r) => r.kind === "tenant_notice_held");
    expect(row).toMatchObject({ group: "today", line: expect.stringContaining("Tenant not told the install day"), button: { label: "Open job", to: "job", section: "install" } });
  });
  test("template hub lists the draft text and email under Waiting, pointing at the live builder and sender", () => {
    for (const id of ["owner:tenant-notice", "owner:sms-tenant_notice"]) {
      const e = TEMPLATE_ENTRIES.find((x) => x.id === id);
      expect({ id, section: e?.section, approval: e?.approval, gate: e?.gate }).toEqual({ id, section: "waiting", approval: "waiting", gate: { kind: "code_off", flag: "TENANT_NOTICE_APPROVED" } });
      expect(e?.source).toEqual({ builder: "src/lib/tenant-notice.core.ts", fn: "tenantNotice", sender: "src/lib/tenant-notice.server.ts" });
      const p = e!.render();
      expect(p.kind === "text" ? p.body : p.kind === "email" ? p.html : "").toContain("power will be off for the day");
    }
  });
});

/* ---------------------------------------------------------------- the sender (deps injected) */
type Job = { id: string; source: string | null; stage: string; deleted_at: string | null; owners: { full_name: string | null; phone: string | null; email: string | null } | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null };
type Booking = { id: string; job_id: string; kind: string; status: string; scheduled_start: string; created_at: string };
const JOB: Job = { id: "j1", source: "website", stage: "installation_booked", deleted_at: null, owners: { full_name: "Sarah Jones", phone: "0400 000 000", email: "sarah@example.com" }, properties: { address_line: "12 Sample Street", suburb: "Glen Waverley", postcode: "3150" } };
const BOOKING: Booking = { id: "b1", job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: START, created_at: "2026-11-01T02:00:00Z" };
const MOVED: Booking = { id: "b2", job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: "2026-11-16T22:00:00Z", created_at: "2026-11-02T02:00:00Z" }; // Tue 17 Nov, 9:00am
const NOW = new Date("2026-11-01T03:00:00Z");

function deps(over: Partial<TenantNoticeDeps> & { job?: Job | null; rental?: RentalAnswers | null; bookings?: Booking[]; optedOut?: string[] } = {}) {
  const sms: { type: string; key: string; to: string | null | undefined; body: string; event?: unknown }[] = [];
  const emails: { to: string; purpose: string; key: string; subject: string; text: string }[] = [];
  const testSent: { channel: string; to: string; body: string }[] = [];
  const events: { type: string; details: Record<string, unknown> }[] = [];
  const claimed = new Set<string>();
  const bookings = over.bookings ?? [BOOKING, MOVED];
  const d: TenantNoticeDeps = {
    approved: true,
    readJob: async () => (over.job === undefined ? JOB : over.job),
    readBooking: async (bookingId) => bookings.find((b) => b.id === bookingId) ?? null,
    rentalAnswers: async () => (over.rental === undefined ? RENTED : over.rental),
    businessContact: async () => rapid,
    quiet: () => false,
    allowed: async () => undefined,
    recordEvent: async (_jobId, type, details) => { events.push({ type, details }); },
    sendSms: async (i) => {
      if ((over.optedOut ?? []).includes(String(i.to))) return { status: "blocked", detail: SMS_REPLIED_STOP, sid: null };
      if (claimed.has(i.idempotencyKey)) return { status: "already", detail: "Already handled", sid: null };
      claimed.add(i.idempotencyKey); sms.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body, event: i.event }); return { status: "sent", detail: "ok", sid: "s" };
    },
    sendEmail: async (p) => {
      if (claimed.has(p.key)) return "already attempted — not resent";
      claimed.add(p.key); const m = p.build(null); emails.push({ to: p.to, purpose: p.purpose, key: p.key, subject: m.subject, text: m.text }); return "sent";
    },
    sendTestSms: async (to, body) => { testSent.push({ channel: "sms", to, body }); return { status: "sent", detail: "ok" }; },
    sendTestEmail: async (to, m) => { testSent.push({ channel: "email", to, body: m.text }); return { status: "sent", detail: "ok" }; },
    ...over,
  };
  return { d, sms, emails, testSent, events };
}

describe("sendTenantNotice", () => {
  test("rented, Tina is the tenant, the property manager lets us in: install booked → ONE text AND ONE email to Tina", async () => {
    const { d, sms, emails, events } = deps();
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("sent: sms sent, email sent");
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ type: "tenant_notice", key: "tenant-notice:v1:b1:sms", to: "+61400111222", event: { at: BOOKING.created_at, current: true } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "tina@example.com", purpose: "tenant_notice", key: "tenant-notice:v1:b1:email" });
    for (const s of ["Fri 13 Nov", "7:30am", "power will be off for the day", "Rapid Insulation", "03 9000 0000"]) {
      expect({ s, sms: sms[0]!.body.includes(s), email: emails[0]!.text.includes(s) }).toEqual({ s, sms: true, email: true });
    }
    expect(events).toEqual([{ type: TENANT_NOTICE_SENT_EVENT, details: expect.objectContaining({ booking_id: "b1", sms: "sent", email: "sent" }) }]);
    // Once per booking and channel.
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("already handled");
    expect(sms).toHaveLength(1); expect(emails).toHaveLength(1);
  });
  test("time changed → a second notice with the new time (new booking, new keys)", async () => {
    const { d, sms, emails } = deps();
    await sendTenantNotice("j1", "b1", NOW, d);
    expect(await sendTenantNotice("j1", "b2", NOW, d)).toBe("sent: sms sent, email sent");
    expect(sms.map((s) => s.key)).toEqual(["tenant-notice:v1:b1:sms", "tenant-notice:v1:b2:sms"]);
    expect(sms[1]!.body).toContain("Tue 17 Nov, 9:00am");
    expect(emails[1]!.text).toContain("Tue 17 Nov");
  });
  test("owner lives there, or never asked → nothing", async () => {
    for (const rental of [OWNER_LIVES, null]) {
      const { d, sms, emails, events } = deps({ rental });
      expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("not rented");
      expect(sms).toHaveLength(0); expect(emails).toHaveLength(0); expect(events).toHaveLength(0);
    }
  });
  test("rented but tenant details missing → held + ONE office note (Needs me row), nothing sent; repeat adds nothing", async () => {
    const { d, sms, emails, events } = deps({ rental: { rented: true, tenant: null, access: null } });
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("held: no tenant details");
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("held: no tenant details");
    expect(sms).toHaveLength(0); expect(emails).toHaveLength(0);
    expect(events).toEqual([{ type: TENANT_NOTICE_HELD_EVENT, details: expect.objectContaining({ booking_id: "b1", reason: "no tenant details" }) }, { type: TENANT_NOTICE_HELD_EVENT, details: expect.objectContaining({ booking_id: "b1", reason: "no tenant details" }) }]);
    expect(new Set(events.map((e) => e.details["id"])).size).toBe(1); // same deterministic id → one row in the database
  });
  test("flag off → awaiting approval, nothing read or sent", async () => {
    let read = false;
    const { d, sms, emails } = deps({ approved: false, readBooking: async () => { read = true; return BOOKING; } });
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("awaiting approval");
    expect(sms).toHaveLength(0); expect(emails).toHaveLength(0); expect(read).toBe(false);
  });
  test("TEST job → test-send for both channels, never the real senders", async () => {
    const { d, sms, emails, testSent } = deps({ job: { ...JOB, source: "qa_test" } });
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe("sent: sms sent, email sent");
    expect(sms).toHaveLength(0); expect(emails).toHaveLength(0);
    expect(testSent.map((t) => [t.channel, t.to])).toEqual([["sms", "+61400111222"], ["email", "tina@example.com"]]);
  });
  test("the owner's Do not contact is never read here (compliance send); a STOP from Tina's number holds the text, the email still goes", async () => {
    expect(readFileSync("src/lib/tenant-notice.server.ts", "utf8")).not.toMatch(/do-not-contact|doNotContact/);
    const { d, sms, emails, events } = deps({ optedOut: ["+61400111222"] });
    expect(await sendTenantNotice("j1", "b1", NOW, d)).toBe(`sent: sms held (${SMS_REPLIED_STOP}), email sent`);
    expect(sms).toHaveLength(0); expect(emails).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: TENANT_NOTICE_SENT_EVENT, details: expect.objectContaining({ booking_id: "b1", email: "sent" }) });
  });
  test("no office phone → held with one office note; not an install, cancelled, past or missing booking → not current; comms locked → messages held", async () => {
    const s = deps({ businessContact: async () => ({ ...rapid, officePhone: null }) });
    expect(await sendTenantNotice("j1", "b1", NOW, s.d)).toBe("held: No office phone for Rapid Insulation");
    expect(s.events).toEqual([{ type: TENANT_NOTICE_HELD_EVENT, details: expect.objectContaining({ booking_id: "b1", reason: "No office phone for Rapid Insulation" }) }]);
    expect(await sendTenantNotice("j1", "b1", NOW, deps({ bookings: [{ ...BOOKING, kind: "assessment" }] }).d)).toBe("not current");
    expect(await sendTenantNotice("j1", "b1", NOW, deps({ bookings: [{ ...BOOKING, status: "cancelled" }] }).d)).toBe("not current");
    expect(await sendTenantNotice("j1", "b1", new Date("2026-11-20T00:00:00Z"), deps().d)).toBe("not current");
    expect(await sendTenantNotice("j1", "nope", NOW, deps().d)).toBe("not current");
    expect(await sendTenantNotice("j1", "b1", NOW, deps({ job: { ...JOB, stage: "cancelled" } }).d)).toBe("not applicable");
    expect(await sendTenantNotice("j1", "b1", NOW, deps({ allowed: async () => { throw new Error("locked"); } }).d)).toBe("messages held");
    expect(await sendTenantNotice("j1", "b1", NOW, deps({ quiet: () => true }).d)).toMatch(/quiet hours/);
  });
});

describe("wiring", () => {
  test("the in-house booking path sends the tenant notice for an install booking, independent of the owner's email outcome; Needs me reads the held events", () => {
    const booking = readFileSync("src/lib/in-house-booking.server.ts", "utf8");
    const fn = booking.split("export async function notifyOwnerBooked")[1]!.split("\nexport async function")[0]!;
    expect(fn).toContain("sendTenantNotice");
    expect(fn.indexOf("sendTenantNotice")).toBeLessThan(fn.indexOf("sendGuardedOwnerEmail"));
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(needs).toContain("tenantNoticeHeldOpen");
    expect(needs).toContain("TENANT_NOTICE_HELD_EVENT");
  });
});
