// Part 4 Task 8 (Jo 2 Nov 2026, answer 4): the owner is emailed straight away when a trade drops a booked visit.
import { beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {}; const admin = memoryPostgrest(tables);
const emails: any[] = [], tests: any[] = [];
const keys = new Set<string>();
let dnc = false;
let inHouse = false; // the real helper holds OLD-flow messages on in-house jobs; this NEW-flow email must ignore it
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/in-house-suppression.server", () => ({ inHouseDispatchSkip: async () => (inHouse ? "in_house" : null) }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (c: any, to: string, subject: string, html: string, text: string) => { tests.push({ c, to, subject, html, text }); return { status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: any) => {
    const { doNotContactBlocks } = await import("../src/lib/do-not-contact.core");
    const why = doNotContactBlocks({ channel: "email", purpose: p.purpose, on: dnc });
    if (why) return `blocked — ${why}`;
    if (keys.has(p.key)) return "already attempted — not resent";
    keys.add(p.key); emails.push({ ...p, mail: p.build(null) }); return "sent";
  },
}));

const core = await import("../src/lib/visit-cancelled-owner.core");
const server = await import("../src/lib/visit-cancelled-owner.server");
const { COMPLIANCE_OWNER_EMAIL_PURPOSES } = await import("../src/lib/do-not-contact.core");
const LINE = "Your visit on Fri 13 Nov can't go ahead. We'll be in touch about a new day.";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: "j", owner_id: "o", source: "website" }];
  tables.owners = [{ id: "o", full_name: "Sarah Jones", email: "sarah@example.com", phone: "0412345678" }];
  tables.bookings = [
    { id: "bi", job_id: "j", kind: "installation", status: "cancelled", scheduled_start: "2026-11-12T21:00:00Z" },
    { id: "bp", job_id: "j", kind: "assessment", status: "cancelled", scheduled_start: "2026-11-12T21:00:00Z" },
  ];
  tables.workflow_events = [];
  emails.length = 0; tests.length = 0; keys.clear(); dnc = false; inHouse = false;
});
const on = { approved: true };

test("flag is off by default; Jo's line is verbatim", () => {
  expect(core.VISIT_CANCELLED_OWNER_APPROVED).toBe(false);
  expect(core.VISIT_CANT_GO_AHEAD_LINE("Fri 13 Nov")).toBe(LINE);
});

test("email: draft subject + greeting, then her line; day is Melbourne time; no job number, link or banned words", () => {
  const m = core.visitCancelledOwnerEmail({ firstName: "Sarah", startIso: "2026-11-12T21:00:00Z" });
  expect(m.subject).toBe("Your visit on Fri 13 Nov can't go ahead");
  expect(m.text).toContain("Hi Sarah,");
  expect(m.text).toContain(LINE);
  expect(m.html).toContain(LINE);
  expect(`${m.subject}${m.text}`).not.toMatch(/lawyer|HIV\b|https?:\/\//);
  expect(m.html).not.toMatch(/lawyer|my-job/);
  expect(core.visitCancelledOwnerEmail({ firstName: null, startIso: "2026-11-12T21:00:00Z" }).text).toContain("Hi there,");
});

test("purpose is not a compliance send; key is per booking", () => {
  expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).not.toContain(core.VISIT_CANCELLED_PURPOSE);
  expect(core.VISIT_CANCELLED_PURPOSE).toBe("visit_cant_go_ahead");
  expect(core.visitCancelledKey("bi")).toBe("visit-cancelled:v1:bi");
});

test("install booking dropped by the installer: exactly one email at the tap, email only", async () => {
  const r = await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on);
  expect(r).toBe("sent");
  expect(emails).toHaveLength(1);
  expect(emails[0].purpose).toBe("visit_cant_go_ahead");
  expect(emails[0].key).toBe("visit-cancelled:v1:bi");
  expect(emails[0].to).toBe("sarah@example.com");
  expect(emails[0].mail.text).toContain(LINE);
  expect(tables.workflow_events!.filter((e) => e.event_type === "visit_cancelled_owner_notice")).toHaveLength(1);
});

test("PIESA booking dropped by the electrician: one email", async () => {
  expect(await server.queueVisitCancelledOwnerEmail("j", "bp", "electrician", on)).toBe("sent");
  expect(emails).toHaveLength(1);
  expect(emails[0].key).toBe("visit-cancelled:v1:bp");
});

test("second call: already attempted, not resent", async () => {
  await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on);
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on)).toBe("already attempted — not resent");
  expect(emails).toHaveLength(1);
});

test("flag false: awaiting approval, nothing recorded or sent", async () => {
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer")).toBe("awaiting approval");
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", { approved: false })).toBe("awaiting approval");
  expect(emails).toHaveLength(0);
  expect(tests).toHaveLength(0);
  expect(tables.workflow_events).toHaveLength(0);
});

test("Do not contact on: blocked (not a compliance send)", async () => {
  dnc = true;
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on)).toMatch(/^blocked/);
  expect(emails).toHaveLength(0);
});

test("in-house job (installer business in_house=true), flag on: the email still sends (new-flow message, not held)", async () => {
  inHouse = true;
  tables.businesses = [{ id: "b", in_house: true }];
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on)).toBe("sent");
  expect(emails).toHaveLength(1);
  expect(emails[0].mail.text).toContain(LINE);
});

test("TEST job: test-send only, even with the flag off", async () => {
  tables.jobs![0]!.source = "qa_test";
  const r = await server.queueVisitCancelledOwnerEmail("j", "bi", "installer");
  expect(r).toMatch(/^email sent/);
  expect(tests).toHaveLength(1);
  expect(emails).toHaveLength(0);
  expect(tests[0].text).toContain(LINE);
});

test("no owner email or no booking: nothing sent, says why", async () => {
  tables.owners![0]!.email = null;
  expect(await server.queueVisitCancelledOwnerEmail("j", "bi", "installer", on)).toBe("not sent — no owner email");
  expect(await server.queueVisitCancelledOwnerEmail("j", "nope", "installer", on)).toBe("not sent — booking not found");
  expect(emails).toHaveLength(0);
});

test("templates register lists it with the draft note", () => {
  const src = readFileSync("src/lib/template-hub.core.ts", "utf8");
  expect(src).toContain("visitCancelledOwnerEmail");
  expect(src).toContain("VISIT_CANCELLED_OWNER_APPROVED");
});
