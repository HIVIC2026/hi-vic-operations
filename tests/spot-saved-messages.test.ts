import { describe, expect, test } from "bun:test";
import { renderSpotSavedEmail, renderSpotSavedSms, addressBits } from "../src/lib/spot-saved-messages.core";
import { readFileSync } from "node:fs";
const i = { firstName: "Sarah", rebate: 1470.6, suburb: "Ballarat", shortAddress: "12 Smith St, Ballarat", myJobUrl: "https://quote.homeinsulationvictoria.com.au/my-job/abc", optOutUrl: "https://quote.homeinsulationvictoria.com.au/email/unsubscribe?t=x" };
describe("spot saved confirmations", () => {
  test("text wording", () => {
    const s = renderSpotSavedSms(i);
    expect(s.startsWith("Spot saved, Sarah! 🎉 Your $1,470 rebate is waiting.")).toBe(true);
    expect(s).toContain("an installer's free in Ballarat.");
    expect(s).toContain("Your job: https://quote.homeinsulationvictoria.com.au/my-job/abc\n– Home Insulation Victoria");
  });
  test("email wording, no phone / call us", () => {
    const e = renderSpotSavedEmail(i);
    expect(e.subject).toBe("Spot saved. Your $1,470 rebate is waiting");
    for (const t of ["You&#39;re on the list", "Spot saved, Sarah. Your", "free Ready Check at 12 Smith St, Ballarat", "Heads up: the waiting list is huge.", "See my job →", "No payment · no obligation", "DC Construction Solutions Pty Ltd", "Privacy", "Remove my enquiry", "#00BF63"]) expect(e.html).toContain(t);
    expect(/call us|phone|1300|04\d{2}/i.test(e.html + e.text)).toBe(false);
  });
  test("address bits", () => expect(addressBits("12 Smith St", "Ballarat")).toEqual({ suburb: "Ballarat", short: "12 Smith St, Ballarat" }));
  test("sent once: only on first save, deduped by history event, video re-save skipped", () => {
    const src = readFileSync("src/lib/launch-campaign.server.ts", "utf8");
    expect(src).toContain("if (firstSave) await queueSpotSavedConfirmations(");
    expect(src).toContain('eq("event_type", "spot_saved_confirmation_queued")');
    expect(src).toContain("if (!existing?.spot_saved_at) {");
    expect(src).toContain('delivery_status: "queued"');
  });
});
