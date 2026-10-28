import { describe, expect, test } from "bun:test";
import { ADDRESS_REQUEST_EMAIL_APPROVED, ADDRESS_REQUEST_EMAIL_PURPOSES, addressRequestOpen, addressRequestStep, type AddressRequestFacts } from "../src/lib/address-request.core";
import { NOT_A_FIRST_RESPONSE_PURPOSES, countsAsFirstResponse } from "../src/lib/automatic-first-response.core";

const HOUR = 3600_000;
const goLive = "2026-10-28T00:00:00.000Z";
const base: AddressRequestFacts = {
  addressLine: "Brighton VIC 3186", source: "base44", channel: "hivic_sourced",
  createdAt: "2026-10-29T00:00:00.000Z", eligibilityOutcome: "needs_onsite_confirmation", goLiveAt: goLive, sentAt: null, reminderAt: null, answeredAt: null,
};
const now = Date.parse("2026-11-01T00:00:00.000Z");

describe("address request rules", () => {
  test("no street, website enquiry after go-live, nothing sent: open, send", () => {
    expect(addressRequestOpen(base)).toBe(true);
    expect(addressRequestStep(base, now)).toBe("send");
  });
  test("sent 23h ago: none; sent 24h ago: remind; reminded: none", () => {
    const sent = (h: number) => ({ ...base, sentAt: new Date(now - h * HOUR).toISOString() });
    expect(addressRequestStep(sent(23), now)).toBe("none");
    expect(addressRequestStep(sent(24), now)).toBe("remind");
    expect(addressRequestStep({ ...sent(30), reminderAt: new Date(now - 6 * HOUR).toISOString() }, now)).toBe("none");
  });
  test("answered: not open, none", () => {
    const f = { ...base, sentAt: new Date(now - 30 * HOUR).toISOString(), answeredAt: new Date(now - HOUR).toISOString() };
    expect(addressRequestOpen(f)).toBe(false);
    expect(addressRequestStep(f, now)).toBe("none");
  });
  test("has a street: not open", () => {
    expect(addressRequestOpen({ ...base, addressLine: "12 Wattle St Brighton" })).toBe(false);
  });
  test("street but no suburb is left to address completion: not open", () => {
    expect(addressRequestOpen({ ...base, addressLine: "12 Wattle St", source: "base44" })).toBe(false);
  });
  test("created before go-live: not open", () => {
    expect(addressRequestOpen({ ...base, createdAt: "2026-10-27T23:59:59.000Z" })).toBe(false);
  });
  test("portal installer job: not open", () => {
    expect(addressRequestOpen({ ...base, source: "portal" })).toBe(false);
  });
  test("go-live not set (feature off): not open, none", () => {
    expect(addressRequestOpen({ ...base, goLiveAt: null })).toBe(false);
    expect(addressRequestStep({ ...base, goLiveAt: null }, now)).toBe("none");
  });
  test("owner told Does Not Appear Eligible: not open, never asked; the other outcomes still are", () => {
    expect(addressRequestOpen({ ...base, eligibilityOutcome: "does_not_appear_eligible" })).toBe(false);
    expect(addressRequestStep({ ...base, eligibilityOutcome: "does_not_appear_eligible" }, now)).toBe("none");
    for (const o of ["likely_eligible", "needs_onsite_confirmation", null]) expect(addressRequestOpen({ ...base, eligibilityOutcome: o })).toBe(true);
  });
  test("the email wording waits for Jo: approval flag is off (house pattern)", () => {
    expect(ADDRESS_REQUEST_EMAIL_APPROVED).toBe(false);
  });
  test("the request emails never count as a first response; every other purpose does", () => {
    expect(NOT_A_FIRST_RESPONSE_PURPOSES).toEqual(ADDRESS_REQUEST_EMAIL_PURPOSES as typeof NOT_A_FIRST_RESPONSE_PURPOSES);
    expect(countsAsFirstResponse("address_request")).toBe(false);
    expect(countsAsFirstResponse("address_request_reminder")).toBe(false);
    for (const p of ["existing_leads_launch_v1", "step3_estimate", "insulation_video_request", null]) expect(countsAsFirstResponse(p)).toBe(true);
  });
});

describe("pending migration 0228: the Enquiries view leaves the request emails out of first response only", () => {
  const read = (p: string) => require("node:fs").readFileSync(new URL(`../${p}`, import.meta.url), "utf8") as string;
  const view = (sql: string) => sql.slice(sql.indexOf("CREATE OR REPLACE VIEW public.office_enquiry_index"));
  test("same as the current definition (drizzle 0153 = 0210) except first_response_sent and response_uncertain", () => {
    const current = view(read("drizzle/migrations/0153_0210_photo_request_facts.sql"));
    const next = view(read("docs/pending-migrations/0228_address_request_not_first_response.sql"));
    const X = " AND s.purpose <> ALL (ARRAY['address_request'::text, 'address_request_reminder'::text])";
    expect(next.split(X).length - 1).toBe(2);
    expect(next.replaceAll(X, "")).toBe(current);
    expect(next).toMatch(new RegExp(`'delivered'::text\\]\\)\\)${X.replace(/[()[\]'.:*?^$|\\<>]/g, "\\$&")}\\)\\) AS first_response_sent`));
    expect(view(read("docs/pending-migrations/0228_address_request_not_first_response.rollback.sql"))).toBe(current);
  });
});
