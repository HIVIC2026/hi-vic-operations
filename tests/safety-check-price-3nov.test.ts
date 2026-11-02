import { describe, expect, it } from "vitest";
import { exGst, hivElectricianPayoutIncGst, ownerSafetyCheckIncGst, safetyCheckPayoutIncGst, withOwnerSafetyCheckPrice } from "../src/lib/safety-check-price.core";

describe("Jo 3 Nov: owner always pays $349 for the safety check", () => {
  it("uses the single $349 setting, and $349 when unset", () => {
    expect(ownerSafetyCheckIncGst(349)).toBe(349);
    expect(ownerSafetyCheckIncGst(null)).toBe(349);
  });
});

describe("Jo 3 Nov 10:30am: installer-source price lists own the owner fee", () => {
  it("Rapid installer job charges $275 and passes all $275 to Rapid", () => {
    const owner = withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 275 }, 349, "installer_sourced", 275).priceIncGst;
    expect(owner).toBe(275);
    const payout = safetyCheckPayoutIncGst({ channel: "installer_sourced", ownerPriceIncGst: owner ?? 0, hivPayoutIncGst: 275 });
    expect(payout).toBe(275);
    expect((owner ?? 0) - payout).toBe(0);
  });
  it("Reinsulate installer job charges its corrected $349 list price", () => {
    expect(withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 420 }, 349, "installer_sourced", 349).priceIncGst).toBe(349);
  });
  it("HIV lead charges $349 and pays the electrician $275 despite Rapid's price", () => {
    const owner = withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 275 }, 349, "hivic_sourced", 275).priceIncGst;
    expect(owner).toBe(349);
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", ownerPriceIncGst: owner ?? 0, hivPayoutIncGst: 275 })).toBe(275);
  });
  it("missing installer price holds instead of falling back to $349 or typed price", () => {
    expect(withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 420 }, 349, "installer_sourced", null).ready).toBe(false);
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

describe("Jo 3 Nov: an electrician's own price no longer sets the owner's price", () => {
  it("Orlando's $350 resolution becomes $349 for the owner", () => {
    expect(withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 350 }, 349).priceIncGst).toBe(349);
  });
  it("a typed $420 different-electrician price becomes $349", () => {
    expect(withOwnerSafetyCheckPrice({ ready: true, priceIncGst: 420 }, null).priceIncGst).toBe(349);
  });
  it("a not-ready (held) electrician stays unpriced", () => {
    expect(withOwnerSafetyCheckPrice({ ready: false, priceIncGst: null }, 349).priceIncGst).toBeNull();
  });
});
