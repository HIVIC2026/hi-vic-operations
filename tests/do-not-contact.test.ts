import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { doNotContactOn, doNotContactBlocks, unsubscribeBlocks } from "../src/lib/do-not-contact.core";
import { smsBlocker, SMS_DO_NOT_CONTACT } from "../src/lib/sms.core";

const ON = [{ event_type: "owner_do_not_contact_set", created_at: "2026-11-10T01:00:00Z" }];
test("latest event wins", () => {
  expect(doNotContactOn(ON)).toBe(true);
  expect(doNotContactOn([...ON, { event_type: "owner_do_not_contact_cleared", created_at: "2026-11-11T01:00:00Z" }])).toBe(false);
  expect(doNotContactOn([{ event_type: "owner_do_not_contact_cleared", created_at: "2026-11-09T01:00:00Z" }, ...ON])).toBe(true);
  expect(doNotContactOn([])).toBe(false);
});
test("compliance sends still go", () => {
  for (const p of ["esc_consent_copy","piesa_copy","veec_assignment_copy","install_complete","completion_pack","install_deposit_paid","non_compliance_notice"])
    expect(doNotContactBlocks({ channel: "email", purpose: p, on: true })).toBeNull();
});
test("unsubscribed owners still get the legal copies, nothing else", () => {
  expect(unsubscribeBlocks({ purpose: "piesa_copy", unsubscribed: true, suppressed: false })).toBe(false);
  expect(unsubscribeBlocks({ purpose: "quote_reminder", unsubscribed: true, suppressed: false })).toBe(true);
  expect(unsubscribeBlocks({ purpose: "piesa_copy", unsubscribed: false, suppressed: true })).toBe(true);
});
test("every automatic owner message stops", () => {
  for (const p of ["quote_reminder","in_house_booked","in_house_partner_call","spot_released","quote_accepted","estimate_followup_day2","install_deposit_day3","after_install_reminder","install_deposit_request","upgrades_needed"])
    expect(doNotContactBlocks({ channel: "email", purpose: p, on: true })).toBe("Owner asked not to be contacted");
  expect(doNotContactBlocks({ channel: "sms", purpose: "piesa_copy", on: true })).toBe("Owner asked not to be contacted");
  expect(doNotContactBlocks({ channel: "email", purpose: "quote_reminder", on: false })).toBeNull();
});
test("smsBlocker refuses owner texts, not partner texts", () => {
  const base = { to: "0400000000", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-11-10T01:00:00Z" };
  expect(smsBlocker({ ...base, type: "quote_reminder", doNotContact: true })).toBe(SMS_DO_NOT_CONTACT);
  expect(smsBlocker({ ...base, type: "boss_price_link", doNotContact: true })).toBeNull();
});
test("guarded owner email reads the flag before sending", () => {
  expect(readFileSync("src/lib/owner-email-send.server.ts", "utf8")).toContain("doNotContactBlocks(");
});

// ---- Task 2: the office sets / clears the flag (fake database) ----
type Ev = { job_id: string; actor_id: string | null; event_type: string; summary: string; details: Record<string, unknown>; created_at: string };
const events: Ev[] = [];
const admins = new Set(["office-1"]);
let tick = 0;
const fake = {
  rpc: async (fn: string, a: { _user_id: string; _role: string }) => ({ data: fn === "has_role" && a._role === "admin" && admins.has(a._user_id), error: null }),
  from: (t: string) => {
    const preds: ((r: Ev) => boolean)[] = [];
    const b: Record<string, unknown> & PromiseLike<unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { preds.push((r) => (r as never as Record<string, unknown>)[c] === v); return b; },
      in: (c: string, v: unknown[]) => { preds.push((r) => v.includes((r as never as Record<string, unknown>)[c])); return b; },
      insert: (p: Omit<Ev, "created_at">) => { if (t === "workflow_events") events.push({ ...p, created_at: new Date(Date.parse("2026-11-10T00:00:00Z") + ++tick * 1000).toISOString() }); return b; },
      update: () => b,
      then: (res: (v: unknown) => unknown) => res({ data: t === "workflow_events" ? events.filter((e) => preds.every((p) => p(e))) : [], error: null }),
    };
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fake }));
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: fake }));

test("office sets once, clears once, repeat is a no-op", async () => {
  const { setDoNotContact } = await import("../src/lib/do-not-contact.server");
  expect(await setDoNotContact("job-1", "office-1", true, "Rang to say stop")).toEqual({ on: true });
  expect(events.filter((e) => e.event_type === "owner_do_not_contact_set")).toHaveLength(1);
  expect(events[0].details.note).toBe("Rang to say stop");
  await setDoNotContact("job-1", "office-1", true, null);
  expect(events).toHaveLength(1);
  expect(await setDoNotContact("job-1", "office-1", false, null)).toEqual({ on: false });
  expect(events.map((e) => e.event_type)).toEqual(["owner_do_not_contact_set", "owner_do_not_contact_cleared"]);
  await setDoNotContact("job-1", "office-1", false, null);
  expect(events).toHaveLength(2);
});
test("only the office can change it", async () => {
  const { setDoNotContact } = await import("../src/lib/do-not-contact.server");
  await expect(setDoNotContact("job-1", "someone-else", true, null)).rejects.toThrow("Only the office can change this.");
  expect(events).toHaveLength(2);
});
test("the server function is a literal office-only chain", () => {
  const src = readFileSync("src/lib/do-not-contact.functions.ts", "utf8");
  expect(src).toContain("createServerFn({ method: \"POST\" }).middleware([requireSupabaseAuth])");
  expect(src).toContain("requireAdmin(");
});
test("the office job page reads the flag and shows the button", () => {
  expect(readFileSync("src/lib/office-job-page.server.ts", "utf8")).toContain("doNotContact");
  const ui = readFileSync("src/components/portal/office-job.tsx", "utf8");
  expect(ui).toContain("Allow contact again");
  expect(ui).toContain("owner replied STOP");
});

// ---- Final fix wave I2: an unsubscribe's consent row does not stop the legal copies ----
import { consentAllowsDelivery } from "../src/lib/do-not-contact.core";
test("unsubscribe consent row: legal copies go, everything else stays blocked", () => {
  const unsub = { consent_status: "not_granted", source: "unsubscribe" };
  for (const p of ["piesa_copy", "esc_consent_copy", "veec_assignment_copy"]) expect(consentAllowsDelivery(unsub, p)).toBe(true);
  expect(consentAllowsDelivery(unsub, "quote_reminder")).toBe(false);
  expect(consentAllowsDelivery(unsub, undefined)).toBe(false);
  expect(consentAllowsDelivery({ consent_status: "not_granted", source: "owner_withdrew" }, "piesa_copy")).toBe(false);
  expect(consentAllowsDelivery({ consent_status: "not_granted", source: null }, "piesa_copy")).toBe(false);
  expect(consentAllowsDelivery(null, "piesa_copy")).toBe(false);
  expect(consentAllowsDelivery({ consent_status: "granted", source: "x" }, "quote_reminder")).toBe(true);
});
test("legal-copy senders pass their purpose to the delivery gate", () => {
  const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");
  expect(src("consent-copy-email.server.ts")).toContain('"ESC consent copy email", "esc_consent_copy")');
  expect(src("piesa-delivery.server.ts")).toContain('"Signed PIESA copy email", "piesa_copy")');
  expect(src("veec-copy-email.server.ts")).toContain('"VEEC assignment copy email", "veec_assignment_copy")');
  expect(src("owner-template-send.server.ts")).toContain("p.label, p.purpose)");
});
