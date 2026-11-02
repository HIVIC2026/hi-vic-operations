import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { giveNotice, jobGiveOffer, saidYesLabel, suggestBatches, type BatchJob, type InHousePartner } from "../src/lib/in-house-batch.core";

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
test("said-yes label uses the owner name in normal case, or Owner when blank", () => {
  expect(saidYesLabel({ ownerName: "WAYNE WILSON", quickTapsYes: true, channel: "website" })).toBe("Wayne Wilson said yes · free Ready Check");
  expect(saidYesLabel({ ownerName: "  ", quickTapsYes: true })).toBe("Owner said yes · free Ready Check");
  expect(saidYesLabel({ quickTapsYes: true })).toBe("Owner said yes · free Ready Check");
  expect(saidYesLabel({ ownerName: "Wayne Wilson", quickTapsYes: false })).toBeNull();
});
test("give notice adds the installer email words", () => {
  const sent = ["a", "b", "c"];
  expect(giveNotice({ sent, refused: [], installerEmail: { status: "not_approved" } }, "Rapid Insulation", id => id))
    .toBe("3 jobs given to Rapid Insulation. No email to Rapid Insulation yet — the email is waiting for your OK in Templates.");
  expect(giveNotice({ sent: ["a"], refused: [{ jobId: "z", reason: "Booked" }], installerEmail: { status: "sent" } }, "Rapid Insulation", id => id.toUpperCase()))
    .toBe("1 job given to Rapid Insulation. Emailed Rapid Insulation the job list. Not given: Z (Booked).");
  expect(giveNotice({ sent: [], refused: [{ jobId: "z", reason: "Booked" }] }, "Rapid", id => id)).toBe("Not given: z (Booked).");
});

test("job page give offer: said yes + nominated active in-house partner covering the home", () => {
  const yes: BatchJob = { ...job, ownerName: "WAYNE WILSON", channel: "website", waitingBusinessId: "p" };
  expect(jobGiveOffer(yes, [partner])).toEqual({ businessId: "p", partnerName: "Rapid Insulation", label: "Wayne Wilson said yes · free Ready Check. Give to Rapid Insulation" });
  expect(jobGiveOffer({ ...yes, ownerName: " " }, [partner])?.label).toBe("Owner said yes · free Ready Check. Give to Rapid Insulation");
});
test("job page give offer is null with no job, no nominee, switch off, not yes, or not covered", () => {
  const yes: BatchJob = { ...job, ownerName: "Wayne", channel: "website", waitingBusinessId: "p" };
  expect(jobGiveOffer(undefined, [partner])).toBeNull();
  expect(jobGiveOffer({ ...yes, waitingBusinessId: null }, [partner])).toBeNull();
  expect(jobGiveOffer(yes, [])).toBeNull();
  expect(jobGiveOffer(yes, [{ ...partner, in_house: false }])).toBeNull();
  expect(jobGiveOffer(yes, [{ ...partner, is_active: false }])).toBeNull();
  expect(jobGiveOffer({ ...yes, quickTapsYes: false }, [partner])).toBeNull();
  expect(jobGiveOffer({ ...yes, waitingBusinessId: "other" }, [partner])).toBeNull();
  expect(jobGiveOffer(yes, [{ ...partner, service_postcodes: ["3000"] }])).toBeNull();
});

test("job page panel shows the give line and button and calls the existing give", () => {
  const src = readFileSync("src/components/portal/choose-installer.tsx", "utf8");
  expect(src).toContain("getInHouseGiveForJob");
  expect(src).toContain("allocateInHouseBatch");
  expect(src).toContain("jobIds: [jobId]");
  expect(src).toContain("`Give to ${offer.partnerName}`");
  expect(src).toContain("giveNotice(r, offer.partnerName");
  expect(src).toContain("{offer.label}");
});
