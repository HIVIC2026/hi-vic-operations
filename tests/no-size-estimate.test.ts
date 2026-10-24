import { test, expect } from "bun:test";
import { noSizeEstimateBlocker } from "../src/lib/no-size-estimate.core";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";
const ok = { areaSource: "typical_default", areaM2: 150, ownerArea: null, insulation: "none", followup: false, automaticInitial: true };
const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "likely_eligible", intakeWorkActive: false, declaredInsulation: "none" as const };
test("no owner size routes to the first reply on the typical area", () => expect(automaticLeadEmail({ ...base, ownerEnteredArea: false })).toEqual({ email: "offer_spot", blocker: null, assumedArea: true }));
test("owner size route unchanged", () => expect(automaticLeadEmail({ ...base, ownerEnteredArea: true })).toEqual({ email: "offer_spot", blocker: null }));
test("TEST and review-required still hold", () => { expect(automaticLeadEmail({ ...base, source: "qa_test", ownerEnteredArea: false }).email).toBe("none"); expect(automaticLeadEmail({ ...base, reviewRequired: true, ownerEnteredArea: false }).email).toBe("none"); });
test("existing insulation uses the existing-insulation offer, not the no-insulation route", () => expect(automaticLeadEmail({ ...base, declaredInsulation: "present", ownerEnteredArea: false }).existingInsulation).toBe(true));
test("allowed only as automatic first reply", () => { expect(noSizeEstimateBlocker(ok)).toBeNull(); expect(noSizeEstimateBlocker({ ...ok, automaticInitial: false })).not.toBeNull(); });
test("owner size entered later blocks stale typical estimate", () => expect(noSizeEstimateBlocker({ ...ok, ownerArea: 120 })).not.toBeNull());
test("wrong area or insulation blocks", () => { expect(noSizeEstimateBlocker({ ...ok, areaM2: 140 })).not.toBeNull(); expect(noSizeEstimateBlocker({ ...ok, insulation: "present" })).not.toBeNull(); expect(noSizeEstimateBlocker({ ...ok, followup: true })).not.toBeNull(); });
test("measured/owner estimates unaffected", () => expect(noSizeEstimateBlocker({ ...ok, areaSource: "owner_estimate", automaticInitial: false })).toBeNull());
import { initialReplyQualifies } from "../src/lib/no-size-estimate.core";
import { readFileSync } from "node:fs";
test("no real typical-size first reply qualifies without an original-enquiry claim", () => expect(initialReplyQualifies({ originalInitialClaim: null })).toBe(false));
test("sender holds real typical-size sends and no longer uses age windows", () => {
  const s = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
  expect(s).toContain("NO_SIZE_REAL_SEND_HELD"); expect(s).not.toContain("initialReplyWindowOk");
});

import { reviewedFollowupNoSizeBlocker } from "../src/lib/no-size-estimate.core";
const fu = { areaSource: "typical_default", areaM2: 150, ownerArea: null, insulation: "present" };
test("reviewed below-R2 follow-up may use labelled 150 m²", () => expect(reviewedFollowupNoSizeBlocker(fu)).toBeNull());
test("reviewed follow-up: owner size, wrong area or no-insulation estimate blocks", () => {
  expect(reviewedFollowupNoSizeBlocker({ ...fu, ownerArea: 120 })).not.toBeNull();
  expect(reviewedFollowupNoSizeBlocker({ ...fu, areaM2: 140 })).not.toBeNull();
  expect(reviewedFollowupNoSizeBlocker({ ...fu, insulation: "none" })).not.toBeNull();
});

test("Jo 21 Oct: Office-approved held send may use the labelled 150 m² estimate; owner size still blocks", () => {
  const { noSizeEstimateBlocker } = require("../src/lib/no-size-estimate.core");
  const base = { areaSource: "typical_default", areaM2: 150, ownerArea: null, followup: false, automaticInitial: false };
  expect(noSizeEstimateBlocker({ ...base, insulation: "none", officeHeld: true })).toBeNull();
  expect(noSizeEstimateBlocker({ ...base, insulation: "present", officeHeld: true, insulationEmail: true })).toBeNull();
  expect(noSizeEstimateBlocker({ ...base, insulation: "none" })).not.toBeNull();
  expect(noSizeEstimateBlocker({ ...base, insulation: "none", ownerArea: 120, officeHeld: true })).not.toBeNull();
});
