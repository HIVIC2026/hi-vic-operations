import { describe, expect, test } from "bun:test";
import { renderSpotSavedEmail, renderSpotSavedSms, addressBits } from "../src/lib/spot-saved-messages.core";
import { readFileSync } from "node:fs";
const i = { firstName: "Sarah", rebate: 1470.6, suburb: "Ballarat", shortAddress: "12 Smith St, Ballarat", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/abc", optOutUrl: "https://estimate.homeinsulationvictoria.com.au/email/unsubscribe?t=x" };
describe("spot saved confirmations", () => {
  test("text wording", () => {
    const s = renderSpotSavedSms(i);
    expect(s.startsWith("Spot saved, Sarah! 🎉 Smart move: your $1,470 rebate is waiting.")).toBe(true);
    expect(s).toContain("an installer is free in Ballarat.");
    expect(s).toContain("Your job: https://estimate.homeinsulationvictoria.com.au/my-job/abc – Home Insulation Victoria");
  });
  test("email wording, no phone / call us", () => {
    const e = renderSpotSavedEmail(i);
    expect(e.subject).toBe("Spot saved. Your $1,470 rebate is waiting");
    // Decision 70 design (O10): logo card, smart-move headline, green rebate line, three steps, See my job, AP footer.
    for (const t of ["Smart move, Sarah. Your spot is saved.", "Your $1,470 rebate is waiting.", "we book homes in the order spots were saved", "When a certified installer is free near Ballarat, we'll text and email you their times for your free Ready Check.", "What happens next", "Tap the time that suits you", "Free Ready Check, then your exact price", ">See my job<", "DC Construction Solutions Pty Ltd", "VEU Accredited Person A003654", "Unsubscribe", "#07BF61"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("/api/public/email-art/");
    expect(e.html).not.toContain("Heads up");
    expect(/call us|phone number|1300|04\d{2}/i.test(e.html + e.text)).toBe(false); // "No phone tag." is approved wording (decision 70)
  });
  test("address bits", () => expect(addressBits("12 Smith St", "Ballarat")).toEqual({ suburb: "Ballarat", short: "12 Smith St, Ballarat" }));
  test("referral card (Jo, 7 Oct): email + plain text when referralUrl present, absent without it, text message unchanged", () => {
    const ref = "https://homeinsulationvictoria.com.au/homeowner?ref=" + "R".repeat(43);
    const e = renderSpotSavedEmail({ ...i, referralUrl: ref });
    for (const t of ["Have a friend who needs a spot saved?", "Send them our free eligibility checker. It takes a minute.", "Send to a friend &rarr;", `href="${ref}"`]) expect(e.html).toContain(t);
    for (const t of ["HAVE A FRIEND WHO NEEDS A SPOT SAVED?", "Send them our free eligibility checker. It takes a minute.", `Send to a friend: ${ref}`]) expect(e.text).toContain(t);
    const without = renderSpotSavedEmail(i);
    expect(without.html).not.toContain("Have a friend who needs a spot saved?");
    expect(without.text).not.toContain("HAVE A FRIEND WHO NEEDS A SPOT SAVED?");
    expect(renderSpotSavedSms({ ...i, referralUrl: ref })).toBe(renderSpotSavedSms(i));
  });
  test("sent once: only on first save, deduped by history event, video re-save skipped", () => {
    const src = readFileSync("src/lib/launch-campaign.server.ts", "utf8");
    expect(src).toContain("if (firstSave) await queueSpotSavedConfirmations(");
    expect(src).toContain('eq("event_type", "spot_saved_confirmation_queued")');
    // Atomic first-save: insert ignoring duplicates, else fill only a row whose spot_saved_at is still null.
    expect(src).toContain('ignoreDuplicates: true');
    expect(src).toContain('.is("spot_saved_at", null)');
    expect(src).toContain('delivery_status: "queued"');
  });
});

import { addressBits as ab } from "../src/lib/spot-saved-messages.core";
import { fullAddress } from "../src/lib/address";
describe("address never repeats", () => {
  test("street line that already holds suburb/postcode", () => {
    expect(ab("20 Banksia Street, Frankston VIC 3199", "Frankston").short).toBe("20 Banksia Street, Frankston");
    expect(fullAddress("20 Banksia Street, Frankston VIC 3199", "Frankston", "3199")).toBe("20 Banksia Street, Frankston VIC 3199");
    expect(fullAddress("20 Banksia Street", "Frankston", "3199")).toBe("20 Banksia Street, Frankston VIC 3199");
  });
});
