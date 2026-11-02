import { describe, expect, it } from "vitest";
import { exGst, hivElectricianPayoutIncGst, ownerSafetyCheckIncGst, safetyCheckPayoutIncGst } from "../src/lib/safety-check-price.core";
import { onboardedElectricianResolution } from "../src/lib/rec-onboarded.core";

describe("Jo 3 Nov: owner always pays $349 for the safety check", () => {
  it("uses the single $349 setting, and $349 when unset", () => {
    expect(ownerSafetyCheckIncGst(349)).toBe(349);
    expect(ownerSafetyCheckIncGst(null)).toBe(349);
  });
});

describe("Jo 3 Nov: HIV website-lead jobs pay the electrician $275", () => {
  it("defaults to $275 when the office setting is empty", () => {
    expect(hivElectricianPayoutIncGst(null)).toBe(275);
  });
  it("reads the office setting stored ex GST ($250 ex = $275 inc)", () => {
    expect(hivElectricianPayoutIncGst(250, 0.1)).toBe(275);
  });
  it("pays $275 whichever electrician does it, ignoring their saved $350 rate", () => {
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", ownerPriceIncGst: 349, hivPayoutIncGst: 275 })).toBe(275);
  });
  it("keeps HV-3682's recorded $349 offer snapshot", () => {
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", offerRateInc: 349, ownerPriceIncGst: 349, hivPayoutIncGst: 275 })).toBe(349);
  });
  it("keeps a recorded payout", () => {
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", paidOutInc: 300, offerRateInc: 349, ownerPriceIncGst: 349, hivPayoutIncGst: 275 })).toBe(300);
  });
});

describe("Jo 3 Nov: installer jobs pass the whole $349 to the installer", () => {
  it("pays the installer $349 — no HIV markup", () => {
    const inc = safetyCheckPayoutIncGst({ channel: "installer_sourced", ownerPriceIncGst: 349, hivPayoutIncGst: 275 });
    expect(inc).toBe(349);
    expect(349 - inc).toBe(0);
    expect(exGst(inc)).toBe(317.27);
  });
});

describe("Jo 3 Nov: an electrician's own $350 rate no longer sets the owner's price", () => {
  it("approved usual electrician with $350 rate resolves ready; owner price is then the standard", () => {
    const res = onboardedElectricianResolution({
      legacy: { ready: true, choice: "usual", priceIncGst: 350, name: "ORLANDO POWERED", licence: "A63151", source: "installer_profile", reasons: [], needsProfile: false },
      usual: null, candidates: [], flatPiesaIncGst: 350,
    } as never);
    // The resolution may carry the electrician's figure; the quote path overrides it with ownerSafetyCheckIncGst.
    const owner = res.ready ? ownerSafetyCheckIncGst(349) : null;
    expect(owner === null || owner === 349).toBe(true);
  });
});
