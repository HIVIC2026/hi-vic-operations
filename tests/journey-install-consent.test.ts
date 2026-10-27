import { expect, test } from "bun:test";
import { JOURNEY_INSTALL_CONSENT } from "../src/lib/journey-test.core";
import { ESC_CONSENT_TEMPLATE_VERSION, ownerConsentBlockers, ownerDeclarationBlockers } from "../src/lib/consent.core";

test("main journey supplies all four required install-consent ticks", () => {
  expect(JOURNEY_INSTALL_CONSENT.declarations).toEqual({
    owner_or_authorised: true, details_accurate: true,
    consent_ap_sends: true, consent_commission_shares: true,
  });
  expect(ownerConsentBlockers({ status: "awaiting_owner", templateApproved: true,
    templateVersion: ESC_CONSENT_TEMPLATE_VERSION, scheduledStart: "2026-11-10T22:00:00Z",
    nowIso: "2026-10-27T04:18:00Z", input: JOURNEY_INSTALL_CONSENT })).toEqual([]);
});

test("each missing journey declaration is still refused by the unchanged portal rule", () => {
  for (const key of ["owner_or_authorised", "details_accurate", "consent_ap_sends", "consent_commission_shares"] as const) {
    expect(ownerDeclarationBlockers({ ...JOURNEY_INSTALL_CONSENT.declarations, [key]: false })).toHaveLength(1);
  }
});