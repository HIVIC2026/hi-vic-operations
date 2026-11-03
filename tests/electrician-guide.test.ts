// Task 9: short "How it works" for electricians (copy approved by Jo 29 Oct 2026, word for word).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_GUIDE_STEPS, ELECTRICIAN_GUIDE_WORDS } from "../src/lib/trade-view.core";

test("electrician guide copy is the approved copy", () => {
  expect(ELECTRICIAN_GUIDE_STEPS).toEqual([
    { title: "Take the job", body: "We text and email you each offer. Accept it in My work if you can do it." },
    { title: "Book the PIESA", body: "Offer the owner 3 times for the Pre Insulation Electrical Safety Assessment (PIESA). It's booked once they pick one." },
    { title: "Do the PIESA in Mitti", body: "Fill in the PIESA form on site and take the photos in Mitti. If fixes are needed, add your price for them on the form. Press Complete when it's finished." },
    { title: "Fixes, if needed", body: "If the owner says yes to the fixes, book a time with them, do the work and fill in the fixes form in Mitti. Press Complete when done." },
  ]);
  expect(ELECTRICIAN_GUIDE_WORDS).toEqual({
    eyebrow: "Electrician guide",
    title: "How every job works",
    sub: "One minute. Four steps and getting paid.",
    paidTitle: "Getting paid",
    paidBody: "We pay your agreed rate 7 days after we approve your completed form. A form that isn't finished can't be paid.",
    back: "Back to My work",
  });
});

// Task 11 (installer screens): the guide page is retired (/field/guide redirects to My work) and the installer guide words
// are gone; the electrician words above stay until Part 6 removes them. The page / tab-title / business-row tests went with it.
