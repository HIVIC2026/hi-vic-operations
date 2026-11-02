import { expect, test } from "bun:test";
import { batchJobEligible, suggestBatches, readyInHouseBatch, type BatchJob, type InHousePartner } from "../src/lib/in-house-batch.core";
const job: BatchJob = { id: "j", stage: "preliminary_estimate_ready", source: "base44", channel: "hivic_sourced", quickTapsYes: true, deleted_at: null, spot_saved_at: "2026-10-30", optedOut: false, hasActiveInstaller: false, postcode: "3199", lat: null, lng: null };
const partner: InHousePartner = { id: "p", name: "Rapid", in_house: true, is_active: true, openJobs: 0, service_postcodes: ["3199"], covers_all_victoria: false, coverage_lat: null, coverage_lng: null, coverage_radius_km: null };
test("lead cannot be given without recorded quick-taps YES", () => expect(batchJobEligible({ ...job, quickTapsYes: false })).toBe(false));
test("lead with recorded quick-taps YES can be given", () => expect(batchJobEligible(job)).toBe(true));
test("installer-sourced does not require quick taps or a saved spot", () => expect(batchJobEligible({ ...job, channel: "installer_sourced", quickTapsYes: false, spot_saved_at: null })).toBe(true));
test("four waiting owners can be given as four, regardless of age", () => {
  const groups = suggestBatches(Array.from({ length: 4 }, (_, i) => ({ ...job, id: String(i), spot_saved_at: "2020-01-01" })), [partner]);
  expect(groups.flatMap(g => readyInHouseBatch(g.jobIds)).sort()).toEqual(["0", "1", "2", "3"]);
});
test("no ids gives nothing", () => expect(readyInHouseBatch([])).toEqual([]));
test("one job can be given on its own", () => expect(readyInHouseBatch(["1"])).toEqual(["1"]));
test("three jobs stay three", () => expect(readyInHouseBatch(["1", "2", "3"])).toEqual(["1", "2", "3"]));
test("seven jobs are not cut down to five", () => expect(readyInHouseBatch(["1", "2", "3", "4", "5", "6", "7"])).toEqual(["1", "2", "3", "4", "5", "6", "7"]));
test("duplicates are sent once, in order", () => expect(readyInHouseBatch(["1", "1", "2"])).toEqual(["1", "2"]));
