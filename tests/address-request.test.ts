import { describe, expect, test } from "bun:test";
import { addressRequestOpen, addressRequestStep, type AddressRequestFacts } from "../src/lib/address-request.core";

const HOUR = 3600_000;
const goLive = "2026-10-28T00:00:00.000Z";
const base: AddressRequestFacts = {
  addressLine: "Brighton VIC 3186", source: "base44", channel: "hivic_sourced",
  createdAt: "2026-10-29T00:00:00.000Z", goLiveAt: goLive, sentAt: null, reminderAt: null, answeredAt: null,
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
});
