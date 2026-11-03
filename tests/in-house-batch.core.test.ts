import { expect, test } from "bun:test";
import { suggestBatches, waitingForCallConsent, type BatchJob, type InHousePartner } from "../src/lib/in-house-batch.core";

const job: BatchJob = { id: "j", stage: "preliminary_estimate_ready", source: "base44", quickTapsYes: true, deleted_at: null, spot_saved_at: "2026-10-30", optedOut: false, hasActiveInstaller: false, postcode: "3199", lat: -38.14, lng: 145.12 };
const partner: InHousePartner = { id: "p", name: "Rapid Insulation", in_house: true, is_active: true, service_postcodes: ["3199"], covers_all_victoria: false, coverage_lat: null, coverage_lng: null, coverage_radius_km: null, openJobs: 0 };
test("saved eligible job matches a partner postcode", () => expect(suggestBatches([job], [partner])).toEqual([{ businessId: "p", jobIds: ["j"] }]));
for (const [label, change] of Object.entries({ deleted: { deleted_at: "2026-10-30" }, test: { source: "qa_test" }, optout: { optedOut: true }, assigned: { hasActiveInstaller: true }, unsaved: { spot_saved_at: null }, wrongStage: { stage: "complete" } })) {
  test(`${label} jobs never appear`, () => expect(suggestBatches([{ ...job, ...change }], [partner])).toEqual([]));
}
test("radius and statewide coverage match; outside radius does not", () => {
  const radius = { ...partner, service_postcodes: [], coverage_lat: -38.14, coverage_lng: 145.12, coverage_radius_km: 5 };
  expect(suggestBatches([job], [radius])).toHaveLength(1);
  expect(suggestBatches([{ ...job, lat: -37 }], [radius])).toEqual([]);
  expect(suggestBatches([job], [{ ...radius, coverage_lat: null, covers_all_victoria: true }])).toHaveLength(1);
});
test("ties choose fewest open jobs and account for this batch's suggestions", () => {
  expect(suggestBatches([job, { ...job, id: "k" }], [{ ...partner, id: "busy", openJobs: 3 }, partner, { ...partner, id: "q" }])).toEqual([{ businessId: "p", jobIds: ["j"] }, { businessId: "q", jobIds: ["k"] }]);
});
test("inactive and non-in-house partners never match", () => {
  expect(suggestBatches([job], [{ ...partner, in_house: false }, { ...partner, is_active: false }])).toEqual([]);
});
test("Task 5: waiting for the owner's tap — consent over 3 months old, no pass yet, or no consent; never installer customers or ineligible jobs", () => {
  const now = "2026-11-03T00:00:00.000Z";
  const c = (at: string, status = "granted") => ({ consent_status: status, consented_at: at, snapshot: {}, source: "base44" });
  expect(waitingForCallConsent(job, [c("2026-10-01T00:00:00.000Z")], now)).toBe(false);
  expect(waitingForCallConsent(job, [c("2026-07-01T00:00:00.000Z")], now)).toBe(true);
  expect(waitingForCallConsent(job, [c("2026-07-01T00:00:00.000Z"), c("2026-11-02T00:00:00.000Z")], now)).toBe(false);
  expect(waitingForCallConsent(job, [c("2026-11-02T00:00:00.000Z", "not_granted")], now)).toBe(true);
  expect(waitingForCallConsent(job, [], now)).toBe(true);
  expect(waitingForCallConsent({ ...job, quickTapsYes: false }, [c("2026-10-01T00:00:00.000Z")], now)).toBe(true);
  expect(waitingForCallConsent({ ...job, oldStylePass: true }, [c("2026-07-01T00:00:00.000Z")], now)).toBe(false);
  expect(waitingForCallConsent({ ...job, oldStylePass: false }, [c("2026-07-01T00:00:00.000Z")], now)).toBe(true);
  expect(waitingForCallConsent({ ...job, channel: "installer_sourced" }, [c("2026-07-01T00:00:00.000Z")], now)).toBe(false);
  expect(waitingForCallConsent({ ...job, hasActiveInstaller: true }, [c("2026-07-01T00:00:00.000Z")], now)).toBe(false);
});
