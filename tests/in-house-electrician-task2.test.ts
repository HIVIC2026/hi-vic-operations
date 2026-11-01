import { expect, test } from "bun:test";
import * as core from "../src/lib/worker-compliance.core";
const valid = { licence_number: "A123", rec_number: "REC456", licence_expires_on: "2099-01-01", licence_verified_at: "2026-11-01T11:41:00Z" };
const check = (w: typeof valid) => (core as unknown as { electricianVerified: (w: typeof valid, today: string) => { ok: boolean; reason: string | null } }).electricianVerified(w, "2026-11-01");
test("electrician with office verification and current licence/REC is verified", () => expect(check(valid)).toEqual({ ok: true, reason: null }));
for (const [field, value, reason] of [
  ["licence_number", "", "Licence number missing"], ["rec_number", " ", "REC number missing"],
  ["licence_expires_on", "2026-10-31", "Licence expired"], ["licence_expires_on", "", "Licence expiry missing"],
  ["licence_expires_on", "not-a-date", "Licence expiry missing"], ["licence_verified_at", "", "Licence + REC not verified by the office"],
] as const) test(`electrician refuses ${field}: ${value || "missing"}`, () => expect(check({ ...valid, [field]: value })).toEqual({ ok: false, reason }));
test("expiry day remains valid", () => expect(check({ ...valid, licence_expires_on: "2026-11-01" }).ok).toBe(true));
test("no verified electrician uses Jo's booking message", () => {
  const rule = (core as unknown as { inHouseElectricianBookingBlocker: (ws: typeof valid[], today: string) => string | null }).inHouseElectricianBookingBlocker;
  expect(rule([], "2026-11-01")).toBe("Add a verified electrician to your Team before booking the safety check.");
  expect(rule([{ ...valid, licence_verified_at: "" }], "2026-11-01")).toBe("Add a verified electrician to your Team before booking the safety check.");
  expect(rule([valid], "2026-11-01")).toBeNull();
});