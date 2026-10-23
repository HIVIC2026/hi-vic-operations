import { describe, it, expect, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("must not read"); } } }));
describe("Jo 23 Oct: preliminary invitation retired", () => {
  it("the invitation sender and owner-email offer picker no longer exist", async () => {
    const m = (await import("../src/lib/email-preliminary-offer.server")) as Record<string, unknown>;
    expect(m.preliminarySaveSpotOffer).toBeUndefined();
    expect(m.recordEmailPreliminaryReview).toBeUndefined();
    expect(typeof m.savePreliminarySpot).toBe("function");
  });
  it("no-photo owner with no insulation uses the normal Save my spot outcome", async () => {
    const { qualifiesOutcome } = await import("../src/lib/enquiry-review-custom.core");
    expect(qualifiesOutcome("none")).toBe("no_insulation");
  });
});
