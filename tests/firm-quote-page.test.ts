import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIRM_PAGE_COPY } from "../src/lib/firm-quote-page-copy.core";

const page = readFileSync(new URL("../src/routes/estimate_.$token.firm-quote.tsx", import.meta.url), "utf8");
const thanks = readFileSync(new URL("../src/components/owner/FirmQuoteThanks.tsx", import.meta.url), "utf8");
const campaign = readFileSync(new URL("../src/routes/estimate_.$token.campaign.tsx", import.meta.url), "utf8");

test("page after Proceed uses Jo's approved wording", () => {
  expect(FIRM_PAGE_COPY.thanks("Alex")).toBe("Thanks, Alex. We're on it.");
  expect(FIRM_PAGE_COPY.assessment).toBe("One of our certified installers will now do a desktop assessment using your photos, aerial imagery and floor plan records.");
  expect(FIRM_PAGE_COPY.emailBy).toBe("We'll email your firm quote by");
  expect(FIRM_PAGE_COPY.nothingLocked).toBe("Nothing is locked in until you accept your firm quote.");
});
test("due date is shown in bold", () => expect(thanks).toContain("{FIRM_PAGE_COPY.emailBy} <strong>{formatDueDate(dueBy)}</strong>."));
test("footer line is exactly Jo's", () => expect(FIRM_PAGE_COPY.footer).toBe("Home Insulation Victoria · VEU Accredited Person A003654"));
test("confirmation has three tick rows, the logo and no house icon", () => {
  expect(page).toContain("{saved ? <FirmQuoteThanks firstName={first} dueBy={dueBy!} />");
  expect(thanks.match(/<Tick>/g)).toHaveLength(3);
  expect(thanks).not.toContain("OwnerHouse");
  expect(page).toContain('className="h-16 w-auto"');
});
test("no button, no tap and no extra text on the page", () => {
  expect(page).not.toMatch(/<button|<Button/);
  expect(page).not.toContain("onClick");
  expect(page).not.toContain("Confirm my firm quote request");
  expect(page).not.toContain("Proceed to firm quote");
  expect(page).not.toContain("shouldFireOneTapSave");
  expect(page).not.toContain("ONE_TAP_SAVE_EVENTS");
  expect(page).not.toContain("addEventListener");
});
test("saves automatically from the page's own script, browser only (never on a plain link fetch)", () => {
  expect(page).toContain("ssr: false");
  const effect = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("}, [token, read, request]);"));
  expect(effect).toContain("read({ data: { token } })");
  expect(effect).toContain("await request({ data: { token } })");
  // Saved once per token, even if the effect runs twice.
  expect(effect).toContain("if (firedFor.current === token) return;");
  expect(page.match(/request\(\{ data: \{ token \} \}\)/g)).toHaveLength(1);
});
test("saving goes straight to the thanks page", () => expect(page).toContain('setFirst(result.firstName ?? r.firstName); setDueBy(result.dueBy); setState("saved");'));
test("closed or unavailable link never saves", () => {
  const effect = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("}, [token, read, request]);"));
  expect(effect.indexOf('if (!r.available) { setState("unavailable"); return; }')).toBeLessThan(effect.indexOf("await request("));
});
test("closed / not eligible keeps the existing friendly line", () => expect(page).toContain("This one's already been taken care of."));
test("already asked shows the same confirmation from the page read", () => expect(page).toContain('if (r.available && r.dueBy) { setDueBy(r.dueBy); setState("saved"); return; }'));

// Jo 7 Nov: reopening the estimate link after Proceed shows the same approved thank-you, from a read only.
test("estimate link shows the thank-you once a firm quote is requested, without saving anything", () => {
  expect(campaign).toContain("firm.data?.available && firm.data.dueBy");
  expect(campaign).toContain("<FirmQuoteThanks firstName={firmThanks.firstName} dueBy={firmThanks.dueBy} estimate=");
  expect(campaign).not.toContain("requestFirmQuoteFn");
});

// Jo 7 Nov (~9:50am, 3a): the estimate link after Proceed shows no Save my spot wording and shows the rebate amount,
// using email 1's approved words only. The Proceed page itself stays exactly as approved (no box).
import { preliminaryEstimateEmail } from "../src/lib/firm-quote-emails.core";
import { firmEstimateBox } from "../src/lib/firm-quote-page-copy.core";
test("estimate link thank-you shows the rebate with email 1's exact words and figures", () => {
  const facts = { rebate: 1120, price: 3178, fullPrice: 4298, areaM2: 150 };
  const email = preliminaryEstimateEmail({ firstName: "Alex", ...facts, removalRatePerM2: 15, proceedUrl: "https://x" }).plainText;
  const box = firmEstimateBox(facts);
  expect(box).toEqual({ rebateLabel: "Your estimated rebate", rebate: "You save $1,120", priceLabel: "Your estimated quote based on what you've told us", price: "$3,178", fullPrice: "incl. GST · full price $4,298", basis: "Based on what you told us: 150 m² ceiling." });
  expect(email).toContain(box.rebateLabel.toUpperCase());
  expect(email).toContain(box.rebate);
  expect(email).toContain(`${box.priceLabel}: ${box.price} incl. GST (full price $4,298)`);
  expect(email).toContain(box.basis);
});
test("estimate link thank-you passes the estimate figures; no Save my spot wording in the thank-you", () => {
  expect(campaign).toContain("estimate={data?.pricing ? { rebate: data.pricing.discount, price: data.pricing.total, fullPrice: data.pricing.gross, areaM2: data.pricing.areaM2 } : null}");
  expect(campaign).toContain("{firmThanks && !isLoading ? <div");
  expect(thanks).toContain("{estimate && <FirmEstimateBox");
  expect(thanks.toLowerCase()).not.toContain("spot");
});
test("Proceed page thank-you is unchanged (no rebate box)", () => expect(page).not.toContain("estimate="));
