// Photo-quote installers Task 7: the quote footnote names the installer and the photos on a photo quote.
import { expect, test } from "bun:test";
import { QUOTE_CHANGES_FOOTNOTE, quoteChangesFootnote } from "../src/lib/quote-changes.core";
import { renderOwnerQuoteEmail } from "../src/lib/owner-quote-email.core";

test("footnote: photo quote names the installer; Ready Check keeps the existing text", () => {
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: true })).toBe("Your quote uses what No Gap Insulation worked out from your photos.");
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: false })).toBe(QUOTE_CHANGES_FOOTNOTE);
  expect(quoteChangesFootnote({ installer: null, photoQuote: true })).toBe("Your quote uses what the installer worked out from your photos.");
});

test("quote email: the changes box carries the photo footnote when given", () => {
  const base = { firstName: "Sam", address: null, totalIncGst: 2200, rebateIncGst: null, lines: [], quoteUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/t?screen=quote", validUntil: null, officePhone: null, v4: true, changes: [{ label: "Ceiling size" as const, estimate: "120 m²", quote: "84.5 m²" }] };
  const photo = renderOwnerQuoteEmail({ ...base, changesFootnote: "Your quote uses what No Gap Insulation worked out from your photos." } as never);
  expect(photo.text).toContain("Your quote uses what No Gap Insulation worked out from your photos.");
  expect(photo.text).not.toContain(QUOTE_CHANGES_FOOTNOTE);
  expect(renderOwnerQuoteEmail(base as never).text).toContain(QUOTE_CHANGES_FOOTNOTE);
});

import { answerDesign, answerNeedsInstaller } from "../src/lib/owner-email-auto-reply.core";
test("automatic replies: a From photos job never says the installer will call to book a Ready Check", () => {
  const f = { firstName: "Sam", link: "https://x/my-job/t", photoQuote: { installer: "No Gap Insulation" } };
  for (const a of ["pick_times", "quote_after_ready_check", "quote_preparing"] as const) {
    const d = answerDesign(a, f);
    expect(d.body).toEqual(["No Gap Insulation is preparing your quote from the photos you sent, so there's no Ready Check visit."]);
    expect(answerNeedsInstaller(a, f)).toBe(false);
  }
  expect(answerNeedsInstaller("pick_times", { visit: null })).toBe(true);
});
