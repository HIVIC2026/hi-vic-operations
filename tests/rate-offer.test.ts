import { describe, expect, test } from "bun:test";
import { applyAgreedRates, baselineForNewRound, offerActivationBlocker, offerErrors, offerState, proposedRates, type OfferRow } from "../src/lib/rate-offer.core";

const inst = { gst_registered: true, r5_rate: 22, batts_removal_rate: 11, loose_fill_removal_rate: 16.5 } as never;
const row = (o: Partial<OfferRow>): OfferRow => ({ id: "o1", round: 1, status: "sent", items: [], note: null, gst_registered: true, created_at: "", responded_at: null, response: null, ...o });

describe("rate offers", () => {
  test("their figures are inc GST from the application", () => {
    const r = proposedRates("installer", inst);
    expect(r.find((i) => i.code === "R5_BATTS")?.partner_inc_gst).toBe(22);
  });
  test("offer equal to their rates is refused; missing codes refused", () => {
    const r = proposedRates("installer", inst);
    expect(offerErrors(r, r.map((i) => i.code)).join()).toContain("Accept rates");
    expect(offerErrors(r.slice(1), r.map((i) => i.code)).join()).toContain("Missing");
  });
  test("activation blocked while waiting or declined; agreed rates used, ex GST", () => {
    expect(offerActivationBlocker(offerState([row({})]))).toContain("waiting");
    expect(offerActivationBlocker(offerState([row({ status: "declined" })]))).toContain("declined");
    const accepted = row({ status: "accepted", items: [{ code: "R5_BATTS", description: "", unit: "m2", partner_inc_gst: 22, offer_inc_gst: 19.8 }] });
    expect(offerActivationBlocker(offerState([accepted]))).toBeNull();
    expect(applyAgreedRates([{ code: "R5_BATTS", unit_price_ex_gst: 20 }], accepted)[0]!.unit_price_ex_gst).toBe(18);
    expect(() => applyAgreedRates([{ code: "X", unit_price_ex_gst: 1 }], accepted)).toThrow();
  });
  test("a declined round carries their new figures into the next round", () => {
    const d = row({ status: "declined", items: [{ code: "R5_BATTS", description: "", unit: "m2", partner_inc_gst: 22, offer_inc_gst: 19 }], response: { proposed: { R5_BATTS: 21 } } });
    expect(baselineForNewRound("installer", inst, [d])[0]).toMatchObject({ partner_inc_gst: 21, offer_inc_gst: 19 });
  });
});
