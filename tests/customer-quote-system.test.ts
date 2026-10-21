import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CUSTOMER_ASSESSMENT_ACTION, CUSTOMER_BRAND, CUSTOMER_CALCULATOR_COPY, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_VISUAL_SYSTEM, CUSTOMER_WHAT_COULD_CHANGE, customerQuoteRows } from "../src/lib/customer-quote-system";

describe("customer quote system", () => {
  test("defines the exact shared brand and canonical ordering", () => {
    expect(CUSTOMER_BRAND.name).toBe("Home Insulation Victoria");
    expect(CUSTOMER_BRAND.logoUrl).toBe("https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png");
    expect(CUSTOMER_BRAND.colors).toEqual({ blue: "#3C51C4", green: "#07BF61", accent: "#52C875", offWhite: "#FBFCFA", navy: "#22376B", white: "#FFFFFF" });
    expect(CUSTOMER_BRAND.font).toBe("'Open Sans',Arial,Helvetica,sans-serif");
    expect(CUSTOMER_QUOTE_ORDER).toEqual([CUSTOMER_QUOTE_LABELS.piesa, CUSTOMER_QUOTE_LABELS.insulation, CUSTOMER_QUOTE_LABELS.apManagement, CUSTOMER_QUOTE_LABELS.projectTotal, CUSTOMER_QUOTE_LABELS.discount, CUSTOMER_QUOTE_LABELS.finalCost]);
    expect(customerQuoteRows({ piesa: 349, installation: 4500, apManagement: 349 }).map((row) => row.label)).toEqual(CUSTOMER_QUOTE_ORDER.slice(0, 3));
  });

  test("defines exact shared payment, change, and insulation copy", () => {
    expect(CUSTOMER_PAYMENT_COPY.notPiesa).toBe("It is not the PIESA.");
    expect(CUSTOMER_EXISTING_INSULATION_NOTE).toBe("Existing insulation: removal MAY be required. It is not included unless shown in the quote. Your Ready Check confirms whether removal is required and, if so, the price before you proceed.");
    expect(CUSTOMER_CALCULATOR_COPY).toBe("Use this calculator to compare how a different Victorian property address or ceiling size could change your estimated project total, VEU / VEEC discount and estimated cost after discount.");
    expect(CUSTOMER_VISUAL_SYSTEM).toEqual({ quoteRadiusPx: 20, secondaryRadiusPx: 16, secondaryPaddingPx: 20, actionRadiusPx: 16, actionPaddingPx: 16, softBlueBorder: "#D4DAF5", softGreenBorder: "#BEE8CE", paleGreen: "#ECF9F1", footer: "#F1F8F3" });
    expect(CUSTOMER_ASSESSMENT_ACTION.cta).toBe("BOOK MY READY CHECK →");
    expect(CUSTOMER_ASSESSMENT_ACTION.paragraphs[0]).toBe("Your Ready Check is free.");
    expect(CUSTOMER_WHAT_COULD_CHANGE.heading).toBe("WHAT COULD CHANGE MY ESTIMATE?");
    expect(CUSTOMER_WHAT_COULD_CHANGE.items).toEqual([]); expect(CUSTOMER_WHAT_COULD_CHANGE.intro).toContain("measured ceiling size, existing insulation and any required removal, ceiling access conditions, and any electrical fixes");
    expect(CUSTOMER_WHAT_COULD_CHANGE.closing).toBe("We will never proceed with additional work or additional costs without first showing you the scope and price and getting your approval.");
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
describe("presentation lock", () => {
  const { readFileSync } = require("node:fs");
  const { renderEstimateEmail, renderIneligibleEmail } = require("../src/lib/estimate-email");
  const { discountAmount, CUSTOMER_QUOTE_LABELS: L, CUSTOMER_WHAT_COULD_CHANGE: W, CUSTOMER_DISCOUNT_TREATMENT: T } = require("../src/lib/customer-quote-system");
  test("discount formatting uses a true minus", () => { expect(discountAmount(1481.76)).toBe("−$1,482"); });
  test("React quote + calculator share one breakdown and one in-card close", () => {
    const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
    expect(ui.match(/<QuoteBreakdown /g)?.length).toBe(1); // retired what-if calculator no longer embeds it
    const qb = ui.slice(ui.indexOf("export function QuoteBreakdown"), ui.indexOf("/** Locked in-card close"));
    const idx = ["rows.map", "CUSTOMER_QUOTE_LABELS.projectTotal", "CUSTOMER_QUOTE_LABELS.discount", "CUSTOMER_QUOTE_LABELS.finalCost"].map((t) => qb.indexOf(t));
    expect(idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]))).toBe(true);
    expect(qb).toContain("bg-estimate-green-soft"); expect(qb).toContain("discountAmount(discount)"); expect(qb).toContain("text-5xl font-extrabold leading-none text-estimate-blue");
    expect(ui.match(/CUSTOMER_WHAT_COULD_CHANGE\.heading/g)?.length).toBe(1); // in-card close only; Ready Check page uses its own single card
    expect(ui).not.toMatch(/no other standard fees/i);
  });
  test("email discount band is green with minus, before final cost; disclaimer once", () => {
    for (const onsite of [false, true]) {
      const src = readFileSync("src/lib/estimate-email.ts", "utf8");
      expect(src).toContain("renderV2QuoteEmail"); // approved v2 email layout (locked) replaced the old discount band
      void onsite; void T; void W; void L;
    }
    expect(readFileSync("src/lib/estimate-email.ts", "utf8")).not.toMatch(/(?<!Your )ESTIMATED VEU DISCOUNT|no other standard fees/i);
    void renderEstimateEmail; void renderIneligibleEmail;
  });
});

describe("closing reassurance lock", () => {
  const { readFileSync } = require("node:fs");
  const { renderEstimateEmail } = require("../src/lib/estimate-email");
  const exact = "We will never proceed with additional work or additional costs without first showing you the scope and price and getting your approval.";
  test("old line absent from all customer sources; renderers consume the shared closing", () => {
    for (const f of ["src/lib/customer-quote-system.ts", "src/lib/estimate-email.ts", "src/lib/followup-email.ts", "src/components/portal/estimate.tsx", "src/routes/step3-email-preview.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toContain("Nothing is simply added");
      expect(s).not.toContain("show you the updated scope and price");
    }
    expect(readFileSync("src/lib/customer-quote-system.ts", "utf8")).toContain(exact);
    expect(readFileSync("src/lib/estimate-email.ts", "utf8")).toContain("CUSTOMER_WHAT_COULD_CHANGE.closing");
    expect(readFileSync("src/components/portal/estimate.tsx", "utf8")).toContain("CUSTOMER_WHAT_COULD_CHANGE.closing");
    void renderEstimateEmail;
  });
});
