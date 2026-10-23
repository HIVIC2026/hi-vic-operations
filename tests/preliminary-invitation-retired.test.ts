import { describe, it, expect, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => { throw new Error("must not read"); } } }));
describe("Jo 23 Oct: preliminary invitation retired", () => {
  it("never previews or sends", async () => {
    const m = await import("../src/lib/email-preliminary-offer.server");
    for (const mode of ["preview", "send"] as const) {
      const r = await m.preliminarySaveSpotOffer("00000000-0000-0000-0000-000000000001", "a", mode);
      expect(r.outcome).toBe("blocked");
    }
  });
  it("no-photo owner with no insulation uses the normal Save my spot outcome", async () => {
    const { qualifiesOutcome } = await import("../src/lib/enquiry-review-custom.core");
    expect(qualifiesOutcome("none")).toBe("no_insulation");
  });
});
