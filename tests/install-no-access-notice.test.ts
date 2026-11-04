// Part 4 Task 7 (Jo 2 Nov 2026, touchpoint 51): "We couldn't get in today" — the installer calls from the office phone to book a new day.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const tables: Tables = {}; const admin = memoryPostgrest(tables);
let contact: { name: string; tradingName: string | null; officePhone: string | null; email: string | null } | null = null;
let deadline: string | null = "2026-11-21";
const emails: any[] = [], texts: any[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/in-house-suppression.server", () => ({ inHouseDispatchSkip: async () => null }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (jobId: string, _a: any, type: string, msg: string, details: any) => { (tables.workflow_events ??= []).push({ job_id: jobId, event_type: type, details, message: msg }); } }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async () => "https://example.invalid/my-job/token" }));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => ({ deadline }) }));
mock.module("../src/lib/owner-contact.server", () => ({ businessContactForJob: async () => contact }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: any) => { emails.push({ ...p, mail: p.build(null) }); return "sent"; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: any) => { texts.push(p); return { status: "sent", detail: "ok" }; } }));

const core = await import("../src/lib/install-no-access-notice.core");
const { sendInstallNoAccessNotice } = await import("../src/lib/install-no-access-notice.server");
const { INSTALL_NO_ACCESS_V2_APPROVED, installNoAccessText, renderInstallNoAccessEmail, installNoAccessKeys } = core;

const f = { firstName: "Helen", installerName: "Rapid Insulation", day: "Tuesday 27 October", officePhone: "03 9000 0000", installBy: "21 November", link: "https://example.invalid/my-job/token" };
const CALL = "Rapid Insulation will call you from 03 9000 0000 to book a new day.";

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: "j", owner_id: "o", source: "website" }];
  tables.owners = [{ id: "o", full_name: "Helen Smith", email: "helen@example.com", phone: "0412345678" }];
  tables.job_assignments = [{ job_id: "j", role: "installer", active: true, businesses: { name: "Rapid Insulation", trading_name: null, onboarding_notes: null } }];
  contact = { name: "Rapid Insulation", tradingName: null, officePhone: "03 9000 0000", email: "info@rapid.example" };
  deadline = "2026-11-21"; emails.length = 0; texts.length = 0;
});

test("flag is off by default; flag off keeps the current wording", () => {
  expect(INSTALL_NO_ACCESS_V2_APPROVED).toBe(false);
  expect(installNoAccessText({ ...f, newDays: [] })).toContain("will send you new days shortly");
  expect(renderInstallNoAccessEmail({ ...f, newDays: [] }).text).toContain("will send you three new days soon");
});

test("flag on: email and text have the verbatim call line and the 30-day rule with the install-by date", () => {
  const e = renderInstallNoAccessEmail(f, true);
  const t = installNoAccessText(f, true);
  expect(e.text).toContain(CALL);
  expect(e.html).toContain(CALL);
  expect(t).toContain(CALL);
  expect(e.text).toContain("21 November");
  expect(e.text).toContain("30 days after your safety check");
  expect(t).toContain("21 November");
  expect(t).toContain("30-day rule");
  expect(e.subject).toBe("Helen, we couldn't get in today");
  expect(t.length).toBeLessThan(306);
  expect(t.endsWith("Reply STOP to opt out.")).toBe(true);
});

test("flag on: nothing promises days, and no job-page link to pick days", () => {
  const e = renderInstallNoAccessEmail(f, true);
  const t = installNoAccessText(f, true);
  for (const s of [e.text, e.html, t]) {
    expect(s).not.toContain("three new days");
    expect(s).not.toContain("new days shortly");
    expect(s).not.toContain("Suggest other days");
    expect(s).not.toContain("Pick a new install day");
    expect(s).not.toContain("my-job");
    expect(s).not.toContain("See my job");
  }
  expect(`${e.text}${e.html}${t}`).not.toMatch(/lawyer|HIV\b/);
});

test("flag on: the installer falls back to 'Your installer' when no name", () => {
  expect(installNoAccessText({ ...f, installerName: null }, true)).toContain("Your installer will call you from 03 9000 0000 to book a new day.");
});

test("flag on: no office phone or no install-by date = not ready (held)", () => {
  expect(core.installNoAccessV2Ready(f)).toBeNull();
  expect(core.installNoAccessV2Ready({ ...f, officePhone: "  " })).toMatch(/office phone/);
  expect(core.installNoAccessV2Ready({ ...f, officePhone: null })).toMatch(/office phone/);
  expect(core.installNoAccessV2Ready({ ...f, installBy: null })).toMatch(/install-by date/);
});

test("server, flag on: sends email + text from the installer's office phone with the same keys", async () => {
  const r = await sendInstallNoAccessNotice({ jobId: "j", bookingId: "b1", wasStart: "2026-10-26T21:00:00Z", reason: "No one home" }, { v2: true, approved: true });
  expect(r).toContain("email sent");
  expect(emails[0].key).toBe(installNoAccessKeys("b1").email);
  expect(emails[0].purpose).toBe("install_no_access");
  expect(emails[0].mail.text).toContain(CALL);
  expect(texts[0].idempotencyKey).toBe(installNoAccessKeys("b1").sms);
  expect(texts[0].type).toBe("install_no_access");
  expect(texts[0].body).toContain(CALL);
});

test("server, flag on: no office phone = held with an office note, nothing sent (never a worker's mobile)", async () => {
  contact = { name: "Rapid Insulation", tradingName: null, officePhone: null, email: "info@rapid.example" };
  const r = await sendInstallNoAccessNotice({ jobId: "j", bookingId: "b2", wasStart: "2026-10-26T21:00:00Z", reason: "No one home" }, { v2: true, approved: true });
  expect(r).toMatch(/held/);
  expect(emails.length + texts.length).toBe(0);
  const held = (tables.workflow_events ?? []).find((e: any) => e.event_type === "install_no_access_owner_notice_not_sent");
  expect(held?.details.booking_id).toBe("b2");
  expect(String(held?.message)).toMatch(/office phone/);
});

test("server, flag on: no install-by date = held", async () => {
  deadline = null;
  const r = await sendInstallNoAccessNotice({ jobId: "j", bookingId: "b3", wasStart: "2026-10-26T21:00:00Z", reason: "No one home" }, { v2: true, approved: true });
  expect(r).toMatch(/held/);
  expect(emails.length + texts.length).toBe(0);
});

test("server, flag off: the current wording and the owner job link still go", async () => {
  const r = await sendInstallNoAccessNotice({ jobId: "j", bookingId: "b4", wasStart: "2026-10-26T21:00:00Z", reason: "No one home" }, { v2: false, approved: true });
  expect(r).toContain("email sent");
  expect(emails[0].mail.text).toContain("will send you three new days soon");
  expect(texts[0].body).toContain("will send you new days shortly");
});
