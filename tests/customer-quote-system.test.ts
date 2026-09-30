import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CUSTOMER_ASSESSMENT_ACTION, CUSTOMER_BRAND, CUSTOMER_CALCULATOR_COPY, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_VISUAL_SYSTEM, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "../src/lib/customer-quote-system";

describe("customer quote system", () => {
  test("defines the exact shared brand and canonical ordering", () => {
    expect(CUSTOMER_BRAND.name).toBe("Home Insulation Victoria");
    expect(CUSTOMER_BRAND.logoUrl).toBe("https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png");
    expect(CUSTOMER_BRAND.colors).toEqual({ blue: "#3C51C4", green: "#07BF61", accent: "#52C875", offWhite: "#FBFCFA", navy: "#22376B", white: "#FFFFFF" });
    expect(CUSTOMER_BRAND.font).toBe("'Open Sans',Arial,Helvetica,sans-serif");
    expect(CUSTOMER_QUOTE_ORDER).toEqual([CUSTOMER_QUOTE_LABELS.insulation, CUSTOMER_QUOTE_LABELS.piesa, CUSTOMER_QUOTE_LABELS.apManagement, CUSTOMER_QUOTE_LABELS.projectTotal, CUSTOMER_QUOTE_LABELS.discount, CUSTOMER_QUOTE_LABELS.finalCost, CUSTOMER_QUOTE_LABELS.payableNow, CUSTOMER_QUOTE_LABELS.remainingBalance]);
    expect(customerQuoteRows({ piesa: 349, installation: 4500, apManagement: 349 }).map((row) => row.label)).toEqual(CUSTOMER_QUOTE_ORDER.slice(0, 3));
  });

  test("defines exact shared payment, change, and insulation copy", () => {
    expect(CUSTOMER_PAYMENT_COPY.notPiesa).toBe("It is not the PIESA.");
    expect(CUSTOMER_EXISTING_INSULATION_NOTE).toBe("Existing insulation: removal MAY be required. It is not included unless shown in the quote. Your Ready Check confirms whether removal is required and, if so, the price before you proceed.");
    expect(CUSTOMER_CALCULATOR_COPY).toBe("Try another ceiling size and instantly see how your preliminary project total, VEU / VEEC discount and estimated cost after discount could change.");
    expect(CUSTOMER_VISUAL_SYSTEM).toEqual({ quoteRadiusPx: 20, secondaryRadiusPx: 16, secondaryPaddingPx: 20, actionRadiusPx: 16, actionPaddingPx: 16, softBlueBorder: "#D4DAF5", softGreenBorder: "#BEE8CE", paleGreen: "#ECF9F1", footer: "#F1F8F3" });
    expect(CUSTOMER_ASSESSMENT_ACTION.cta).toBe("BOOK MY READY CHECK →");
    expect(CUSTOMER_ASSESSMENT_ACTION.paragraphs[0]).toBe("Your $99 Home Insulation Ready Check is credited toward your project if you proceed.");
    expect(CUSTOMER_WHAT_COULD_CHANGE.heading).toBe("WHAT COULD CHANGE MY ESTIMATE?");
    expect(CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead }) => lead)).toEqual(["Ceiling size", "Existing insulation", "Access", "Electrical rectification"]);
    expect(CUSTOMER_WHAT_COULD_CHANGE.closing).toBe("If any of these apply, we’ll show you the updated scope and price before you decide whether to proceed. Nothing is simply added without being shown to you first.");
  });

  test("customer-facing Step 3 sources consume the shared system and contain no HI VIC shorthand", () => {
    const files = ["src/components/portal/estimate.tsx", "src/components/portal/EstimateHeader.tsx", "src/lib/estimate-email.ts", "src/lib/ineligible-email.ts", "src/lib/followup-email.ts", "src/lib/estimatelink.core.ts", "src/routes/estimate.$token.tsx", "src/routes/step3-email-preview.tsx"];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/\bHI VIC\b/);
    for (const file of ["src/components/portal/estimate.tsx", "src/lib/estimate-email.ts", "src/components/portal/EstimateHeader.tsx", "src/routes/step3-email-preview.tsx"]) expect(readFileSync(file, "utf8")).toContain("customer-quote-system");
  });

  test("customer delivery locks retain false defaults", () => {
    expect(readFileSync("drizzle/migrations/0018_customer_comms_lock.sql", "utf8")).toContain("customer_comms_enabled boolean NOT NULL DEFAULT false");
    expect(readFileSync("drizzle/migrations/0038_customer_delivery_settings.sql", "utf8")).toContain("enabled boolean NOT NULL DEFAULT false");
  });
});