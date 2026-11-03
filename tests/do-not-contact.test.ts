import { expect, test } from "bun:test";
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
  expect(smsBlocker({ ...base, type: "job_offer", doNotContact: true })).toBeNull();
});
test("guarded owner email reads the flag before sending", () => {
  expect(readFileSync("src/lib/owner-email-send.server.ts", "utf8")).toContain("doNotContactBlocks(");
});
