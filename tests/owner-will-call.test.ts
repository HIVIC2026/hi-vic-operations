// Decision #23 (Jo 2 Nov 2026): "{Installer} will call you" email + text, with the installer's OFFICE phone.
import { beforeEach, describe, expect, test } from "bun:test";
import { OWNER_WILL_CALL_APPROVED, ownerWillCallEmail, ownerWillCallText } from "../src/lib/owner-will-call.core";
import { sendInHousePartnerCall, sweepInHousePartnerCalls, type WillCallDeps } from "../src/lib/in-house-batch-email.server";
import type { BusinessContact } from "../src/lib/owner-wording.core";

const rapid: BusinessContact = { name: "Rapid Insulation", tradingName: null, officePhone: "03 9000 0000", email: "office@rapid.example" };

describe("ownerWillCallEmail / ownerWillCallText (approved #23 wording)", () => {
  test("approved wording, word for word", () => {
    const m = ownerWillCallEmail({ firstName: "Sarah", installer: rapid, unsubscribeUrl: null }) as { subject: string; text: string; html: string };
    expect(m.subject).toBe("Rapid Insulation will call you");
    expect(m.text).toContain("Hi Sarah,");
    expect(m.text).toContain("Rapid Insulation is the EEC-certified installer for your home. They'll call you soon from 03 9000 0000 to book your free Ready Check.");
    expect(m.text).toContain("At the Ready Check they'll measure up and confirm your quote. It's free, with no obligation.");
    expect(m.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
    expect(m.html).toContain("Rapid Insulation will call you");
    expect(m.html).toContain("03 9000 0000");
    expect(ownerWillCallText("Sarah", rapid)).toBe("Home Insulation Victoria: Hi Sarah, Rapid Insulation will call you soon from 03 9000 0000 to book your free Ready Check.");
  });
  test("no office phone or no business email → held, never a blank", () => {
    expect(ownerWillCallEmail({ firstName: "Sarah", installer: { ...rapid, officePhone: null }, unsubscribeUrl: null })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(ownerWillCallEmail({ firstName: "Sarah", installer: { ...rapid, email: null }, unsubscribeUrl: null })).toEqual({ held: "No business email for Rapid Insulation" });
    expect(ownerWillCallEmail({ firstName: "Sarah", installer: { ...rapid, officePhone: "  " }, unsubscribeUrl: null })).toEqual({ held: "No office phone for Rapid Insulation" });
    expect(ownerWillCallText("Sarah", { ...rapid, officePhone: null })).toEqual({ held: "No office phone for Rapid Insulation" });
  });
  test("trading name is the name owners see; no first name → plain greeting", () => {
    const m = ownerWillCallEmail({ firstName: null, installer: { ...rapid, name: "Rapid Pty Ltd", tradingName: "Rapid Insulation" }, unsubscribeUrl: null }) as { subject: string; text: string };
    expect(m.subject).toBe("Rapid Insulation will call you");
    expect(m.text).toContain("Hi,");
    expect(ownerWillCallText(null, rapid)).toBe("Home Insulation Victoria: Hi there, Rapid Insulation will call you soon from 03 9000 0000 to book your free Ready Check.");
  });
  test("ships switched off", () => { expect(OWNER_WILL_CALL_APPROVED).toBe(false); });
});

/* ------------------------------------------------------------ sender (fake db, injected senders) */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let one = false;
  const run = () => { const hits = (tables[table] ?? []).filter(r => filters.every(f => f(r))); return { data: one ? hits[0] ?? null : hits, error: null }; };
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; }, neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; }, in: (k: string, v: unknown[]) => { filters.push(r => v.includes(r[k])); return q; },
    order: () => q, limit: () => q, maybeSingle: () => { one = true; return q; },
    then: (res: (x: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return q;
}
const db = { from } as unknown as WillCallDeps["db"];
let emails: { purpose: string; key: string; to: string; subject: string; text: string }[] = [];
let smsSent: { type: string; idempotencyKey: string; to: string | null | undefined; body: string }[] = [];
let held: { type: string; details: Row }[] = [];
let contact: BusinessContact | null = rapid;
let allowed = true;
const deps = (over: Partial<WillCallDeps> = {}): Partial<WillCallDeps> => ({
  db, approved: true, now: () => new Date("2026-11-03T01:00:00Z"), // 12pm Melbourne
  contactFor: async () => contact,
  assertAllowed: async () => { if (!allowed) throw new Error("paused"); },
  sendEmail: async (p) => {
    if ((tables["customer_email_sends"] ?? []).some(r => r["idempotency_key"] === p.key)) return "already attempted — not resent";
    tables["customer_email_sends"]!.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key });
    const m = p.build("https://example.com/u");
    emails.push({ purpose: p.purpose, key: p.key, to: p.to, subject: m.subject, text: m.text });
    return "sent";
  },
  sendSms: async (i) => { smsSent.push({ type: i.type, idempotencyKey: i.idempotencyKey, to: i.to, body: i.body }); return { status: "sent", detail: "ok", sid: "x" }; },
  logEvent: async (jobId, _a, type, _s, details) => { tables["workflow_events"]!.push({ job_id: jobId, event_type: type, details }); held.push({ type, details: details ?? {} }); },
  ...over,
});
beforeEach(() => {
  tables = {
    jobs: [{ id: "j", source: "base44", deleted_at: null, stage: "preliminary_estimate_ready", owners: { email: "sarah@example.com", full_name: "Sarah Smith", phone: "0400 111 222" } }],
    workflow_events: [{ job_id: "j", event_type: "in_house_partner_call_email_pending", created_at: "2026-11-03T00:00:00Z", details: { business_id: "b", batch_id: "batch", partner_trading_name: "Rapid Insulation" }, "jobs.deleted_at": null, "jobs.source": "base44" }],
    job_assignments: [{ job_id: "j", business_id: "b", role: "installer", active: true }],
    customer_email_sends: [],
    bookings: [],
  };
  emails = []; smsSent = []; held = []; contact = rapid; allowed = true;
});

describe("sendInHousePartnerCall builds #23 from the core", () => {
  test("sends the approved email + owner_will_call text once, keeping purpose and key", async () => {
    expect(await sendInHousePartnerCall("j", deps())).toBe("sent");
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ purpose: "in_house_partner_call", key: "in-house-partner-call:v1:j", to: "sarah@example.com", subject: "Rapid Insulation will call you" });
    expect(emails[0]!.text).toContain("Rapid Insulation · 03 9000 0000 · office@rapid.example");
    expect(smsSent).toEqual([{ type: "owner_will_call", idempotencyKey: "in-house-partner-call:v1:j:sms", to: "0400 111 222", body: "Home Insulation Victoria: Hi Sarah, Rapid Insulation will call you soon from 03 9000 0000 to book your free Ready Check." }]);
    expect(await sendInHousePartnerCall("j", deps())).toBe("already attempted");
    expect(emails).toHaveLength(1);
    expect(smsSent).toHaveLength(1);
  });
  test("flag off → awaiting approval, nothing read, sent or recorded", async () => {
    contact = { ...rapid, officePhone: null };
    expect(await sendInHousePartnerCall("j", deps({ approved: false }))).toBe("awaiting approval");
    expect(emails).toEqual([]); expect(smsSent).toEqual([]); expect(held).toEqual([]);
    expect(await sweepInHousePartnerCalls(deps({ approved: false }))).toEqual({ checked: 0, sent: 0 });
    expect(emails).toEqual([]); expect(smsSent).toEqual([]); expect(held).toEqual([]);
  });
  test("a job that already had the old partner call email gets nothing (one version per job)", async () => {
    tables["customer_email_sends"]!.push({ job_id: "j", purpose: "in_house_partner_call", idempotency_key: "in-house-partner-call:v1:j" });
    expect(await sendInHousePartnerCall("j", deps())).toBe("already attempted");
    expect(emails).toEqual([]); expect(smsSent).toEqual([]);
    expect(await sweepInHousePartnerCalls(deps())).toEqual({ checked: 0, sent: 0 });
  });
  test("no back-send: past the Ready Check booking step, or a confirmed Ready Check booking → not applicable", async () => {
    tables["jobs"]![0]!["stage"] = "ready_check_scheduled";
    expect(await sendInHousePartnerCall("j", deps())).toBe("not applicable");
    tables["jobs"]![0]!["stage"] = "measured_estimate_ready";
    expect(await sendInHousePartnerCall("j", deps())).toBe("not applicable");
    tables["jobs"]![0]!["stage"] = "ready_check_ready_to_schedule";
    tables["bookings"]!.push({ job_id: "j", kind: "ready_check", status: "confirmed" });
    expect(await sendInHousePartnerCall("j", deps())).toBe("not applicable");
    expect(emails).toEqual([]); expect(smsSent).toEqual([]); expect(held).toEqual([]);
    tables["bookings"] = [{ job_id: "j", kind: "ready_check", status: "cancelled" }];
    expect(await sendInHousePartnerCall("j", deps())).toBe("sent");
  });
  test("no office phone / no business email / no installer → held with ONE office event per reason, nothing sent", async () => {
    contact = { ...rapid, officePhone: null };
    expect(await sendInHousePartnerCall("j", deps())).toBe("held: No office phone for Rapid Insulation");
    expect(await sendInHousePartnerCall("j", deps())).toBe("held: No office phone for Rapid Insulation");
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ type: "owner_will_call_held", details: { reason: "No office phone for Rapid Insulation" } });
    contact = { ...rapid, email: null };
    expect(await sendInHousePartnerCall("j", deps())).toBe("held: No business email for Rapid Insulation");
    expect(held).toHaveLength(2);
    contact = null;
    expect(await sendInHousePartnerCall("j", deps())).toBe("held: No installer business on file");
    expect(emails).toEqual([]); expect(smsSent).toEqual([]);
    // Office fixes the details → the next tick sends.
    contact = rapid;
    expect(await sweepInHousePartnerCalls(deps())).toEqual({ checked: 1, sent: 1 });
    expect(emails).toHaveLength(1); expect(smsSent).toHaveLength(1);
  });
  test("messages paused / no consent → nothing sent or recorded", async () => {
    allowed = false;
    expect(await sendInHousePartnerCall("j", deps())).toBe("messages held");
    expect(emails).toEqual([]); expect(smsSent).toEqual([]); expect(held).toEqual([]);
  });
  test("quiet hours → waits for the tick, so email and text go together", async () => {
    expect(await sendInHousePartnerCall("j", deps({ now: () => new Date("2026-11-03T11:00:00Z") }))).toBe("quiet hours"); // 10pm Melbourne
    expect(emails).toEqual([]); expect(smsSent).toEqual([]);
  });
  test("no owner phone → email only", async () => {
    (tables["jobs"]![0]!["owners"] as Row)["phone"] = null;
    expect(await sendInHousePartnerCall("j", deps())).toBe("sent");
    expect(emails).toHaveLength(1); expect(smsSent).toEqual([]);
  });
  test("email not sent → no text", async () => {
    expect(await sendInHousePartnerCall("j", deps({ sendEmail: async () => "blocked — not sent" }))).toBe("blocked — not sent");
    expect(smsSent).toEqual([]);
  });
});
