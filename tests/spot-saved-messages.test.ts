import { describe, expect, test } from "bun:test";
import { renderSpotSavedEmail, renderSpotSavedSms, addressBits } from "../src/lib/spot-saved-messages.core";
import { friendShareHref, friendShareBody } from "../src/lib/email-kit.core";
const i = { firstName: "Sarah", rebate: 1470.6, suburb: "Ballarat", shortAddress: "12 Smith St, Ballarat", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/abc", optOutUrl: "https://estimate.homeinsulationvictoria.com.au/email/unsubscribe?t=x" };
describe("spot saved confirmations", () => {
  test("text wording", () => {
    const s = renderSpotSavedSms(i);
    expect(s.startsWith("Home Insulation Victoria: Spot saved, Sarah! 🎉 Smart move: your $1,470 rebate is waiting.")).toBe(true);
    // Decision 20 (2 Nov): installer-will-call sentence, no link.
    expect(s).toContain("Spots are released in the order they were saved. When an EEC-certified installer is available, they'll call you to book your free Ready Check.");
    expect(s).not.toMatch(/as soon as|https?:|Your job/);
  });
  test("email wording, no phone / call us", () => {
    const e = renderSpotSavedEmail(i);
    expect(e.subject).toBe("Spot saved. Your $1,470 rebate is waiting");
    // Decision 70 design (O10): logo card, smart-move headline, green rebate line, steps, See my job, AP footer; decision 388 spot-only wording.
    expect(e.html + e.text).not.toMatch(/as soon as|soon|shortly/); // decision 388 still holds apart from the decision-19 step 2
    for (const t of ["Smart move, Sarah. Your spot is saved.", "Your $1,470 rebate is waiting", "Spots are released in the order they were saved.", "A certified installer will call you", "What happens next", "Your place is kept", "DC Construction Solutions Pty Ltd", "VEU Accredited Person A003654", "Unsubscribe"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("/api/public/email-art/");
    expect(e.html).not.toContain("Heads up");
    expect(/call us|phone number|1300|04\d{2}/i.test(e.html + e.text)).toBe(false); // "No phone tag." is approved wording (decision 70)
  });
  test("address bits", () => expect(addressBits("12 Smith St", "Ballarat")).toEqual({ suburb: "Ballarat", short: "12 Smith St, Ballarat" }));
  test("referral card (Jo, 7 Oct): email + plain text when referralUrl present, absent without it, text message unchanged", () => {
    const ref = "https://homeinsulationvictoria.com.au/homeowner?ref=" + "R".repeat(43);
    const e = renderSpotSavedEmail({ ...i, referralUrl: ref });
    for (const t of ["Have a friend who needs a spot saved?", "Send them our free eligibility checker. It takes a minute.", "Send to a friend &rarr;", "href=\"mailto:?subject=Free%20ceiling%20insulation%20check&amp;body=", encodeURIComponent(ref)]) expect(e.html).toContain(t);
    for (const t of ["HAVE A FRIEND WHO NEEDS A SPOT SAVED?", "Send them our free eligibility checker. It takes a minute.", `Send to a friend: ${ref}`]) expect(e.text).toContain(t);
    const without = renderSpotSavedEmail(i);
    expect(without.html).not.toContain("Have a friend who needs a spot saved?");
    expect(without.text).not.toContain("HAVE A FRIEND WHO NEEDS A SPOT SAVED?");
    expect(renderSpotSavedSms({ ...i, referralUrl: ref })).toBe(renderSpotSavedSms(i));
  });
  // Save/confirmation replay behaviour is exercised by the atomic database and
  // real-handler isolated tests, not firstSave source-text assertions.
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

describe("Send to a friend (Jo, 27 Oct)", () => {
  test("opens a new email with the homeowner page link written in", () => {
    const link = "https://homeinsulationvictoria.com.au/homeowner?ref=abc";
    const href = friendShareHref(link);
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    const body = decodeURIComponent(new URL(href).searchParams.get("body") ?? "");
    expect(body).toContain(link);
    expect(body).toBe(friendShareBody(link));
  });
});
