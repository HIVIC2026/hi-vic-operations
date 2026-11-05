// Part 10 Task 6: the owner's quote page (My job ?screen=quote) for an installer's OWN customer — the installer's logo
// beside ours in the header and the approved lines in "What you're paying for" — behind OWN_CUSTOMER_COBRAND_APPROVED.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OWN_CUSTOMER_LABELS, ownCustomerQuoteView } from "../src/lib/own-customer-price.core";

const items = [
  { code: "INSTALLER_PRICE", description: "Insulation works by your installer — includes: Ceiling insulation - supply & install", line_total_inc_gst: 2000 },
  { code: "AP_FEE", description: "Home Insulation Victoria fee", line_total_inc_gst: 349 },
  { code: "PIESA", description: "Electrical safety check (PIESA)", line_total_inc_gst: 275 }, // Rapid's own PIESA rate (Jo 4 Nov 2026)
];
const own = { channel: "installer_sourced", approved: true, installerName: "Rapid Insulation", logoUrl: "https://x/rapid-logo.png", items, rebateIncGst: 600, totalIncGst: 2024 };
const labels = (v: ReturnType<typeof ownCustomerQuoteView>) => v.rows?.map((r) => r.label) ?? null;

describe("ownCustomerQuoteView (pure)", () => {
  test("own customer + approved + https logo → both logos and the approved rows", () => {
    const v = ownCustomerQuoteView(own);
    expect(v.cobrand).toEqual({ url: "https://x/rapid-logo.png", alt: "Rapid Insulation" });
    expect(labels(v)).toEqual([OWN_CUSTOMER_LABELS.insulation, OWN_CUSTOMER_LABELS.apFee, OWN_CUSTOMER_LABELS.piesa, OWN_CUSTOMER_LABELS.rebate, OWN_CUSTOMER_LABELS.total]);
    expect(v.rows!.map((r) => r.amountIncGst)).toEqual([2000, 349, 275, -600, 2024]);
    expect(v.rows![0]!.detail).toBe(items[0]!.description);
  });
  test("no logo / http logo / no name → our logo alone, rows still the approved lines", () => {
    for (const f of [{ logoUrl: null }, { logoUrl: "http://x/logo.png" }, { installerName: null }]) {
      const v = ownCustomerQuoteView({ ...own, ...f });
      expect(v.cobrand).toBeNull();
      expect(labels(v)).toEqual(["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA) — charged by Home Insulation Victoria", "Rebate", "Your price"]);
    }
  });
  test("extras sit between Insulation and the fee under their own words", () => {
    const v = ownCustomerQuoteView({ ...own, items: [items[0]!, { code: "INSTALLER_REMOVAL", description: "Removal of existing insulation (40 m²)", line_total_inc_gst: 300 }, items[1]!, items[2]!], totalIncGst: 2324 });
    expect(labels(v)).toEqual(["Insulation", "Removal of existing insulation (40 m²)", "Home Insulation Victoria fee", "Electrical safety check (PIESA) — charged by Home Insulation Victoria", "Rebate", "Your price"]);
  });
  test("not approved → both null; Home Insulation Victoria lead → both null; a malformed line set → rows null (never a guessed label)", () => {
    expect(ownCustomerQuoteView({ ...own, approved: false })).toEqual({ cobrand: null, rows: null });
    expect(ownCustomerQuoteView({ ...own, channel: "hivic_sourced" })).toEqual({ cobrand: null, rows: null });
    expect(ownCustomerQuoteView({ ...own, channel: null })).toEqual({ cobrand: null, rows: null });
    const v = ownCustomerQuoteView({ ...own, items: items.filter((i) => i.code !== "AP_FEE") });
    expect(v.rows).toBeNull();
    expect(v.cobrand).not.toBeNull();
  });
  test("I1: a quote is shown at the PIESA amount it carries (Deep's $349 as $349, Rapid's $275 as $275), never re-priced; a mismatched total → generic rows", () => {
    const deep = ownCustomerQuoteView({ ...own, installerName: "Reinsulate", items: [items[0]!, items[1]!, { code: "PIESA", description: "Electrical safety check (PIESA)", line_total_inc_gst: 349 }], totalIncGst: 2098 });
    expect(deep.rows!.map((r) => r.amountIncGst)).toEqual([2000, 349, 349, -600, 2098]);
    // a total that doesn't match the rows (edited quote) → generic rows, the brand still applies
    const edited = ownCustomerQuoteView({ ...own, totalIncGst: 2200 });
    expect(edited.rows).toBeNull();
    expect(edited.cobrand).not.toBeNull();
  });
});

describe("wiring (source facts)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  test("resolveOwnerJob builds the view from the pure builder with the one switch; the page header shows the partner logo; the quote screen uses the approved rows when present", () => {
    const s = read("src/lib/owner-myjob.server.ts");
    expect(s).toContain("ownCustomerQuoteView({");
    expect(s).toContain("approved: OWN_CUSTOMER_COBRAND_APPROVED");
    expect(s).toContain("businessLogoUrl(");
    expect(s).toContain("cobrand: ownView.cobrand");
    expect(s).toContain("ownRows: ownView.rows");
    const kit = read("src/components/owner/OwnerPageKit.tsx");
    expect(kit).toContain("partnerLogo?: { url: string; alt: string } | null");
    expect(kit).toContain("{partnerLogo && <img src={partnerLogo.url} alt={partnerLogo.alt} className=\"h-9 w-auto max-w-[120px] object-contain object-right\" />}");
    expect(kit.indexOf("src={logo.url}")).toBeLessThan(kit.indexOf("src={partnerLogo.url}"));
    const page = read("src/routes/my-job.$token.tsx");
    expect(page).toContain("partnerLogo={data?.cobrand ?? null}");
    expect(page).toContain('data-testid="quote-lines-own"');
    expect(page).toContain("q.ownRows ?");
  });
});
