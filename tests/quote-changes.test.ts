// Photo-quote installers Task 7: the quote footnote names the installer and the photos on a photo quote.
import { expect, test } from "bun:test";
import { QUOTE_CHANGES_FOOTNOTE, quoteChangesFootnote } from "../src/lib/quote-changes.core";
import { renderOwnerQuoteEmail } from "../src/lib/owner-quote-email.core";

test("footnote: Ready Check keeps the existing text; a photo quote has NO footnote until approved, then names the installer", () => {
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: false })).toBe(QUOTE_CHANGES_FOOTNOTE);
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: true })).toBeNull();
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: true, newWording: false })).toBeNull();
  expect(quoteChangesFootnote({ installer: "No Gap Insulation", photoQuote: true, newWording: true })).toBe("Your quote uses what No Gap Insulation worked out from your photos.");
  expect(quoteChangesFootnote({ installer: null, photoQuote: true, newWording: true })).toBe("Your quote uses what the installer worked out from your photos.");
});

import { PHOTO_QUOTE_OWNER_WORDING_APPROVED, photoOwnerWording } from "../src/lib/photo-quote.core";
test("approval flag: off; the new wording only when approved AND given From photos — never an installer's own customer", () => {
  expect(PHOTO_QUOTE_OWNER_WORDING_APPROVED).toBe(false);
  expect(photoOwnerWording(true)).toBe(false); // flag off
  expect(photoOwnerWording(false)).toBe(false);
  expect(photoOwnerWording(true, true)).toBe(true); // flag on, HIV lead given From photos
  expect(photoOwnerWording(false, true)).toBe(false); // flag on, own customer (sent no photos)
});

test("quote email on a photo quote with the flag off: no Ready Check line anywhere, no footnote", () => {
  const base = { firstName: "Sam", address: "1 Main St, Richmond VIC 3121", totalIncGst: 2200, rebateIncGst: null, lines: [], quoteUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/t?screen=quote", validUntil: null, officePhone: null, v4: true, changes: [{ label: "Ceiling size" as const, estimate: "120 m²", quote: "84.5 m²" }] };
  const off = renderOwnerQuoteEmail({ ...base, changesFootnote: null } as never);
  expect(off.text).not.toMatch(/ready check/i);
  expect(off.html).not.toMatch(/ready check/i);
  expect(off.text).toContain("1 Main St, Richmond VIC 3121");
  const rc = renderOwnerQuoteEmail(base as never);
  expect(rc.text).toContain("Measured at your Ready Check");
  expect(rc.text).toContain(QUOTE_CHANGES_FOOTNOTE);
});

test("quote email: the changes box carries the photo footnote when given", () => {
  const base = { firstName: "Sam", address: null, totalIncGst: 2200, rebateIncGst: null, lines: [], quoteUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/t?screen=quote", validUntil: null, officePhone: null, v4: true, changes: [{ label: "Ceiling size" as const, estimate: "120 m²", quote: "84.5 m²" }] };
  const photo = renderOwnerQuoteEmail({ ...base, changesFootnote: "Your quote uses what No Gap Insulation worked out from your photos." } as never);
  expect(photo.text).toContain("Your quote uses what No Gap Insulation worked out from your photos.");
  expect(photo.text).not.toContain(QUOTE_CHANGES_FOOTNOTE);
  expect(renderOwnerQuoteEmail(base as never).text).toContain(QUOTE_CHANGES_FOOTNOTE);
});

import { answerDesign, answerNeedsInstaller, photoAnswerHeld } from "../src/lib/owner-email-auto-reply.core";
test("automatic replies, flag on + given From photos: the spec's photo line; never 'will call to book a Ready Check'", () => {
  const f = { firstName: "Sam", link: "https://x/my-job/t", photoQuote: { installer: "No Gap Insulation", newWording: true } };
  for (const a of ["pick_times", "quote_after_ready_check", "quote_preparing"] as const) {
    const d = answerDesign(a, f);
    expect(d.body).toEqual(["No Gap Insulation is preparing your quote from your photos."]);
    expect(answerNeedsInstaller(a, f)).toBe(false);
    expect(photoAnswerHeld(a, f)).toBe(false);
  }
  expect(answerNeedsInstaller("pick_times", { visit: null })).toBe(true);
});
test("automatic replies, flag off (or an own customer): the Ready Check sentences go, no new sentence is added", () => {
  const f = { firstName: "Sam", link: "https://x/my-job/t", photoQuote: { installer: "No Gap Insulation", newWording: false } };
  const prep = answerDesign("quote_preparing", f);
  expect(prep.body).toEqual(["We'll email you as soon as your quote is ready."]);
  expect(JSON.stringify(prep)).not.toMatch(/ready check|photos/i);
  // Nothing true is left in these two: held as a draft for the office, never sent.
  expect(photoAnswerHeld("pick_times", f)).toBe(true);
  expect(photoAnswerHeld("quote_after_ready_check", f)).toBe(true);
  expect(photoAnswerHeld("quote_preparing", f)).toBe(false);
  expect(photoAnswerHeld("pick_times", { photoQuote: null })).toBe(false);
});
