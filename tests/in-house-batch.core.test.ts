import { expect, test } from "bun:test";
import { suggestBatches, type BatchJob, type InHousePartner } from "../src/lib/in-house-batch.core";

const job: BatchJob = { id: "j", stage: "preliminary_estimate_ready", source: "base44", deleted_at: null, spot_saved_at: "2026-10-30", optedOut: false, hasActiveInstaller: false, postcode: "3199", lat: -38.14, lng: 145.12 };
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