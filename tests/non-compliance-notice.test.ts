// Part 4 Task 13 (Jo 2 Nov 2026, answer 9; cl 27): the office tells the owner straight away that something didn't comply.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {}; const base = memoryPostgrest(tables);
const admins = new Set(["office-1"]);
const admin = { ...base, rpc: async (fn: string, a: { _user_id: string; _role: string }) => ({ data: fn === "has_role" && a._role === "admin" && admins.has(a._user_id), error: null }) };
const emails: any[] = [], tests: any[] = [];
const keys = new Set<string>();
let dnc = false, unsub = false;
let contact: any = { name: "Sample Insulation Pty Ltd", tradingName: "Sample Insulation", officePhone: "03 9000 0000", email: "office@sample.example" };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
// Faithful stand-in for comms.server: the REAL consentAllowsDelivery against the latest owner_contact_consents row, so a
// purpose that is not passed through (or is not a compliance purpose) is held for an unsubscribed owner.
mock.module("../src/lib/comms.server", () => ({
  assertCustomerDeliveryAllowed: async (jobId: string, what: string, purpose?: string) => {
    const { consentAllowsDelivery } = await import("../src/lib/do-not-contact.core");
    const latest = (tables.owner_contact_consents ?? []).filter((c) => c.job_id === jobId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
    if (purpose && consentAllowsDelivery(latest, purpose)) return;
    if (latest?.consent_status !== "granted") throw new Error(`Owner contact consent missing (${what})`);
  },
}));
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async () => contact }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (c: any, to: string, subject: string, html: string, text: string) => { tests.push({ c, to, subject, html, text }); return { status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: any) => {
    const dncc = await import("../src/lib/do-not-contact.core");
    const why = dncc.doNotContactBlocks({ channel: "email", purpose: p.purpose, on: dnc });
    if (why) return `blocked — ${why}`;
    if (dncc.unsubscribeBlocks({ purpose: p.purpose, unsubscribed: unsub, suppressed: false })) return "blocked — unsubscribed";
    if (keys.has(p.key)) return "already attempted — not resent";
    keys.add(p.key); emails.push({ ...p, mail: p.build(null) }); return "sent";
  },
}));

const core = await import("../src/lib/non-compliance-notice.core");
const server = await import("../src/lib/non-compliance-notice.server");
const { COMPLIANCE_OWNER_EMAIL_PURPOSES } = await import("../src/lib/do-not-contact.core");
const WHAT = "the insulation near the downlights was installed too close";
const FIX = "we will move it back to the right distance";
const on = { approved: true };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: "j", owner_id: "o", source: "website" }];
  tables.owners = [{ id: "o", full_name: "Sarah Jones", email: "sarah@example.com" }];
  tables.workflow_events = [];
  tables.owner_contact_consents = [{ id: "c1", job_id: "j", consent_status: "granted", source: "website", created_at: "2026-10-01T00:00:00Z" }];
  emails.length = 0; tests.length = 0; keys.clear(); dnc = false; unsub = false;
  contact = { name: "Sample Insulation Pty Ltd", tradingName: "Sample Insulation", officePhone: "03 9000 0000", email: "office@sample.example" };
});

test("flag is off by default; purpose is a compliance purpose", () => {
  expect(core.NON_COMPLIANCE_NOTICE_APPROVED).toBe(false);
  expect(core.NON_COMPLIANCE_PURPOSE).toBe("non_compliance_notice");
  expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).toContain("non_compliance_notice");
});

test("pack 1 item 39 (Jo 4 Nov 2026, approved): the exact words — what we found, the free fix, who calls, nothing else changes, the office phone; no banned words or links", () => {
  const c = { name: "Sample Insulation Pty Ltd", tradingName: "Sample Insulation", officePhone: "03 9000 0000", email: "office@sample.example" };
  const m = core.nonComplianceNotice({ firstName: "Sarah", what: WHAT, fix: FIX, contact: c });
  expect(m.subject).toBe("About your ceiling insulation — one thing we need to put right");
  const lines = m.text.split("\n");
  expect(lines.slice(0, 7)).toEqual([
    "Hi Sarah,",
    "",
    `We've checked your job and found one thing that doesn't meet the program's rules: ${WHAT}.`,
    `We'll fix it at no cost to you: ${FIX}.`,
    "Sample Insulation will call you to arrange a time.",
    "Nothing else changes — your rebate and your price stay as they are.",
    "Questions? Reply to this email or call Sample Insulation on 03 9000 0000.",
  ]);
  expect(m.text).toContain("Sample Insulation · 03 9000 0000 · office@sample.example");
  // html carries the same words (entity-escaped apostrophes aside)
  for (const p of ["one thing that doesn", "at no cost to you", "will call you to arrange a time.", "Nothing else changes — your rebate and your price stay as they are.", "Reply to this email or call Sample Insulation on 03 9000 0000."]) expect(m.html.replace(/&#39;|&apos;/g, "'")).toContain(p);
  expect(`${m.subject}${m.text}`).not.toMatch(/lawyer|HIV\b|https?:\/\/|\brepairs?\b|\bfixes\b/);
  expect(core.nonComplianceNotice({ firstName: null, what: WHAT, fix: FIX, contact: c }).text).toContain("Hi there,");
  // the phone is the office number only: a contact with no office phone is held by the server, never a mobile substituted
  expect(core.nonComplianceNotice({ firstName: "Sarah", what: WHAT, fix: FIX, contact: { ...c, officePhone: "  " } }).text).not.toMatch(/04\d{2}/);
  expect(core.nonComplianceKey("j", WHAT, FIX)).toMatch(/^non-compliance:v1:j:/);
});

test("office presses the button: one email with what and fix", async () => {
  const r = await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on);
  expect(r).toBe("sent");
  expect(emails).toHaveLength(1);
  expect(emails[0].purpose).toBe("non_compliance_notice");
  expect(emails[0].to).toBe("sarah@example.com");
  expect(emails[0].mail.text).toContain(WHAT);
  expect(emails[0].mail.text).toContain(FIX);
  const ev = tables.workflow_events!.filter((e) => e.event_type === "non_compliance_notice_sent");
  expect(ev).toHaveLength(1);
  expect(ev[0].actor_id).toBe("office-1");
});

test("office only: installer and electrician sessions are refused, nothing sent or recorded", async () => {
  for (const who of ["installer-1", "electrician-1"]) {
    await expect(server.sendNonComplianceNotice("j", who, { what: WHAT, fix: FIX }, on)).rejects.toThrow("Only the office can send this.");
  }
  expect(emails).toHaveLength(0);
  expect(tables.workflow_events).toHaveLength(0);
});

test("once per note: pressing again with the same note does not resend; a new note does", async () => {
  await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on);
  const again = await server.sendNonComplianceNotice("j", "office-1", { what: `  ${WHAT} `, fix: FIX }, on);
  expect(again).toContain("already");
  expect(emails).toHaveLength(1);
  expect(tables.workflow_events!.filter((e) => e.event_type === "non_compliance_notice_sent")).toHaveLength(1);
  expect(await server.sendNonComplianceNotice("j", "office-1", { what: "the product label is wrong", fix: "we will replace it" }, on)).toBe("sent");
  expect(emails).toHaveLength(2);
  expect(emails[0].key).not.toBe(emails[1].key);
});

test("goes with Do not contact on and to an unsubscribed owner (compliance purpose)", async () => {
  dnc = true; unsub = true;
  // Fix wave I1: the unsubscribe writes a not_granted consent row (source "unsubscribe"); the delivery assert only lets it
  // through when the compliance purpose is passed.
  tables.owner_contact_consents!.push({ id: "c2", job_id: "j", consent_status: "not_granted", source: "unsubscribe", created_at: "2026-10-20T00:00:00Z" });
  expect(await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on)).toBe("sent");
  expect(emails).toHaveLength(1);
});

test("a plain not_granted consent (not an unsubscribe) still holds it", async () => {
  tables.owner_contact_consents!.push({ id: "c2", job_id: "j", consent_status: "not_granted", source: "website", created_at: "2026-10-20T00:00:00Z" });
  expect(await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on)).toMatch(/^not sent/);
  expect(emails).toHaveLength(0);
});

test("never sent on its own: nothing in src calls it except the office server function", async () => {
  const { execSync } = await import("node:child_process");
  const out = execSync("grep -rlw 'sendNonComplianceNotice' src || true", { encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  expect(out).toEqual(["src/lib/non-compliance-notice.functions.ts", "src/lib/non-compliance-notice.server.ts"]);
});

test("flag off: real owners get nothing and nothing is recorded; TEST jobs test-send", async () => {
  expect(await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, { approved: false })).toBe("awaiting approval");
  expect(emails).toHaveLength(0);
  expect(tables.workflow_events).toHaveLength(0);
  tables.jobs = [{ id: "j", owner_id: "o", source: "qa_test" }];
  await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, { approved: false });
  expect(tests).toHaveLength(1);
  expect(emails).toHaveLength(0);
});

test("no office phone or business email: held with an office note, nothing sent, never a mobile", async () => {
  contact = { name: "Sample", tradingName: null, officePhone: null, email: "office@sample.example" };
  const r = await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on);
  expect(r).toMatch(/^held/);
  expect(emails).toHaveLength(0);
  expect(tables.workflow_events!.map((e) => e.event_type)).toEqual(["non_compliance_notice_held"]);
  contact = null;
  expect(await server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: FIX }, on)).toMatch(/^held/);
});

test("blank what or fix is refused", async () => {
  await expect(server.sendNonComplianceNotice("j", "office-1", { what: " ", fix: FIX }, on)).rejects.toThrow();
  await expect(server.sendNonComplianceNotice("j", "office-1", { what: WHAT, fix: "" }, on)).rejects.toThrow();
  expect(emails).toHaveLength(0);
});
