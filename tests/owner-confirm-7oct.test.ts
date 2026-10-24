import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONFIRM_JOB_TITLE, CONFIRMED_QUOTE_TITLE, OWNER_AGREED_TICK, PIESA_FIXES_NOTE, agreedWithLabel, ownerAgreedBlocker, ownerPriceEmailText, ownerPriceTitle, signedSummaryNote } from "../src/lib/owner-confirm.core";

describe("owner confirm link for installer-quoted jobs (Jo 7 Oct 9:25pm)", () => {
  test("titles", () => {
    expect(ownerPriceTitle({ agreed: true, installerName: "Reinsulate" })).toBe("Confirm your insulation job");
    expect(ownerPriceTitle({ agreed: false, installerName: null })).toBe("Your confirmed quote");
    expect(ownerPriceTitle(null)).toBe(CONFIRMED_QUOTE_TITLE);
    expect(CONFIRM_JOB_TITLE).not.toMatch(/quote/i);
  });
  test("As agreed with label", () => {
    expect(agreedWithLabel({ agreed: true, installerName: "Reinsulate" })).toBe("As agreed with Reinsulate");
    expect(agreedWithLabel({ agreed: false, installerName: "Reinsulate" })).toBeNull();
  });
  test("tick needs Quoted Yes with a price; unticked never blocks", () => {
    expect(OWNER_AGREED_TICK).toBe("The owner has agreed to my price");
    expect(ownerAgreedBlocker({ ownerAgreed: false, quoted: null })).toBeNull();
    expect(ownerAgreedBlocker({ ownerAgreed: true, quoted: "no" })).not.toBeNull();
    expect(ownerAgreedBlocker({ ownerAgreed: true, quoted: "yes", price: 0 })).not.toBeNull();
    expect(ownerAgreedBlocker({ ownerAgreed: true, quoted: "yes", price: 3450 })).toBeNull();
  });
  test("exact PIESA note in email and signed summary", () => {
    expect(PIESA_FIXES_NOTE).toBe("Your Pre Insulation Electrical Safety Assessment (PIESA) may find electrical work that needs fixing before insulation can go in. Any electrical fixes are completely separate from this price. If needed, you'll receive a separate quote for that work to approve. Nothing is done without your OK.");
    const e = ownerPriceEmailText({ firstName: "Sam", agreed: { agreed: true, installerName: "Reinsulate" }, total: 1234.5, link: "https://x/my-job/t" });
    expect(e.subject).toContain("Confirm your insulation job");
    expect(e.text).toContain(PIESA_FIXES_NOTE);
    expect(e.text).toContain("As agreed with Reinsulate");
    expect(e.text).toContain("$1,234.50");
    expect(signedSummaryNote()).toContain(PIESA_FIXES_NOTE);
  });
  test("wired into the owner page, booking step, signed Gate B copy and Add one job", () => {
    const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(page.match(/<FixesNote \/>/g)?.length).toBe(2);
    expect(page).toContain("ownerPriceTitle(v.agreed)");
    expect(readFileSync("src/lib/owner-gates.server.ts", "utf8")).toContain('d.gate === "B" ? (await import("./owner-confirm.core")).signedSummaryNote()');
    // Decision 34 (Jo 24 Oct): Add a job is basics only, so the optional agreed-price tick is no longer asked there; the record stays on the intake server path.
    expect(readFileSync("src/components/trade/add-job-flow.tsx", "utf8")).not.toContain("OWNER_AGREED_TICK");
    expect(readFileSync("src/lib/partner-import.server.ts", "utf8")).toContain("owner_agreed_price: true");
  });
});
