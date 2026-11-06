import { expect, test } from "bun:test";
import { preliminaryEstimateEmail, firmQuoteOnItsWayEmail, firmQuoteReadyEmail } from "../src/lib/firm-quote-emails.core";

const estimate = { firstName: "Alex", price: 2940, rebate: 1610, fullPrice: 4550, areaM2: 150, insulation: "present" as const, removalRatePerM2: 15, proceedUrl: "https://example.test/estimate/test-token/firm-quote" };
const ready = { firstName: "Alex", price: 3390, rebate: 1530, fullPrice: 4920, ownerM2: 150, confirmedM2: 142, removalM2: 40, removalRatePerM2: 15, validUntil: "2026-12-20", acceptUrl: "https://example.test/my-job/test-token" };

const decode = (html: string) => html.replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&amp;/g, "&");
const twins = (e: { html: string; plainText: string }) => [decode(e.html), e.plainText];
const ACTION = "One of our certified installers will do a desktop assessment using your photos, aerial imagery and floor plan records. We'll email your firm quote within 7 business days. If your photos are unclear or don't show enough of your roof space, our panel of certified installers may not be able to complete the desktop assessment.";
const O1 = "That's the Victorian Energy Upgrades (VEU) rebate, taken straight off your price. To get it you need a certified installer, a licensed electrician and an Accredited Person. We bring them together and run the whole job for you.";

test("email 1 subject and preview use caller amounts, no spot wording", () => {
  const email = preliminaryEstimateEmail(estimate);
  expect(email.subject).toBe("Alex, your preliminary estimate: $2,940 after a $1,610 rebate");
  expect(email.previewText).toBe("Your price could be $2,940 after the government rebate.");
});
test("email 1 headline and O1 intro, never the some-insulation wording", () => {
  for (const body of twins(preliminaryEstimateEmail(estimate))) {
    expect(body).toContain("Alex, you could save $1,610 on ceiling insulation");
    expect(body).toContain(O1);
    expect(body).not.toContain("You told us there's some insulation");
    expect(body).not.toContain("may qualify");
  }
});
test("email 1 rebate and price boxes", () => {
  for (const body of twins(preliminaryEstimateEmail(estimate))) {
    for (const line of ["You save $1,610", "$2,940", "$4,550", "Based on what you told us: 150 m² ceiling."]) expect(body).toContain(line);
    expect(body.toLowerCase()).toContain("your estimated rebate");
    expect(body.toLowerCase()).toContain("your estimated quote based on what you've told us");
    expect(body).not.toContain("150 m² ceiling,");
  }
});
for (const insulation of ["none", "present", "unknown"] as const) test(`email 1 is one version for insulation ${insulation}`, () => {
  const email = preliminaryEstimateEmail({ ...estimate, insulation });
  expect(email).toEqual(preliminaryEstimateEmail(estimate));
  expect(decode(email.html)).toContain("If you have existing insulation");
  expect(email.plainText).toContain("IF YOU HAVE EXISTING INSULATION");
  expect(email.html).not.toContain("Your existing insulation");
});
test("email 1 existing-insulation card keeps today's rows", () => {
  for (const body of twins(preliminaryEstimateEmail(estimate))) {
    for (const line of ["it may be able to stay.", "If it can stay", "New batts go straight over the top.", "$0", "$15/m²", "Up to $2,250 for your 150 m² ceiling.", "Prices incl. GST. You'll know the exact cost before you agree to anything."]) expect(body).toContain(line);
  }
});
test("email 1 firm quote action section and button", () => {
  const email = preliminaryEstimateEmail(estimate);
  for (const body of twins(email)) {
    expect(body.toLowerCase()).toContain("get your firm quote – no home visit needed");
    expect(body).toContain(ACTION);
    expect(body).toContain("Proceed to firm quote");
    expect(body).toContain("https://example.test/estimate/test-token/firm-quote");
  }
  expect(email.html).toContain('href="https://example.test/estimate/test-token/firm-quote"');
});
test("email 1 keeps What's included, Not included, R2.0 closing and VEU box", () => {
  for (const body of twins(preliminaryEstimateEmail(estimate))) {
    expect(body.toLowerCase()).toContain("what's included in $2,940");
    expect(body.toLowerCase()).toContain("not included – only if needed");
    expect(body).toContain("If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know. You'll see your exact price before you agree to anything.");
  }
});
test("email 1 never mentions spots, Ready Check or calling", () => {
  const email = preliminaryEstimateEmail(estimate);
  for (const body of [email.subject, email.previewText, ...twins(email)]) {
    for (const retired of ["spot", "Spot", "Save my", "Ready Check", "call us", "Why the price might change"]) expect(body).not.toContain(retired);
  }
});
test("email 1 removal rate and total come from caller", () => {
  const email = preliminaryEstimateEmail({ ...estimate, removalRatePerM2: 12 });
  for (const body of twins(email)) {
    expect(body).toContain("$12/m²");
    expect(body).toContain("$1,800");
    expect(body).not.toContain("$15/m²");
    expect(body).not.toContain("$15 per m²");
  }
});
test("email 1 names, price and proceed link are caller inputs", () => {
  const email = preliminaryEstimateEmail({ ...estimate, firstName: "Sam", price: 3000, proceedUrl: "https://example.test/new-request" });
  expect(email.subject).toBe("Sam, your preliminary estimate: $3,000 after a $1,610 rebate");
  expect(email.previewText).toBe("Your price could be $3,000 after the government rebate.");
  for (const body of twins(email)) {
    expect(body).toContain("Sam, you could save $1,610 on ceiling insulation");
    expect(body).toContain("https://example.test/new-request");
  }
});
test("day-four subject and due-date preview", () => {
  const email = firmQuoteOnItsWayEmail({ firstName: "Alex", dueDate: "2026-11-20" });
  expect(email.subject).toBe("Your firm quote is on its way");
  expect(email.previewText).toBe("Your firm quote will be with you by Friday 20 November.");
  for (const body of [email.html, email.plainText]) expect(body).toContain("Your installer is checking your ceiling size and photos now. Your firm quote will be with you by Friday 20 November. Nothing for you to do in the meantime.");
});
test("day-four due date is caller-owned", () => expect(firmQuoteOnItsWayEmail({ firstName: "Sam", dueDate: "2026-11-17" }).plainText).toContain("Tuesday 17 November"));
test("firm quote subject and confirmed-size preview", () => {
  const email = firmQuoteReadyEmail(ready);
  expect(email.subject).toBe("Your firm quote is ready: $3,390 after rebate");
  expect(email.previewText).toBe("We confirmed your ceiling at 142 m².");
});
test("firm quote twins show owner and confirmed size", () => {
  const email = firmQuoteReadyEmail(ready);
  for (const body of [email.html, email.plainText]) expect(body).toContain("You told us 150 m². We confirmed 142 m².");
});
test("firm quote removal line uses caller area and rate", () => {
  const email = firmQuoteReadyEmail(ready);
  for (const body of [email.html, email.plainText]) {
    expect(body).toContain("Removal of old insulation");
    expect(body).toContain("40 m² × $15 = $600");
  }
});
test("changed caller removal rate changes both twins", () => {
  const email = firmQuoteReadyEmail({ ...ready, removalRatePerM2: 12.5 });
  for (const body of [email.html, email.plainText]) expect(body).toContain("40 m² × $12.5 = $500");
});
test("zero removal has no removal line", () => {
  const email = firmQuoteReadyEmail({ ...ready, removalM2: 0 });
  for (const body of [email.html, email.plainText]) expect(body).not.toContain("Removal of old insulation");
});
test("missing owner area drops only the owner-size sentence", () => {
  const email = firmQuoteReadyEmail({ ...ready, ownerM2: null });
  for (const body of [email.html, email.plainText]) {
    expect(body).not.toContain("You told us");
    expect(body).not.toMatch(/\b0 m²/);
    expect(body).toContain("We confirmed 142 m².");
  }
});
test("firm quote twins carry price, rebate and validity", () => {
  const email = firmQuoteReadyEmail(ready);
  for (const body of [email.html, email.plainText]) {
    for (const line of ["You save $1,530", "$3,390", "$4,920", "Your quote is valid for 30 days, until Sunday 20 December.", "Accept my quote"]) expect(body).toContain(line);
  }
});
test("validity and accept link are caller inputs", () => {
  const email = firmQuoteReadyEmail({ ...ready, validUntil: "2026-12-21", acceptUrl: "https://example.test/replacement-quote" });
  for (const body of [email.html, email.plainText]) {
    expect(body).toContain("Monday 21 December");
    expect(body).toContain("https://example.test/replacement-quote");
  }
});
test("emails 2 and 3 carry the approved full-brand sign-off; email 1 footer is as today", () => {
  for (const email of [firmQuoteOnItsWayEmail({ firstName: "Alex", dueDate: "2026-11-20" }), firmQuoteReadyEmail(ready)]) {
    for (const body of [email.html, email.plainText]) expect(body).toContain("Cheers, the Home Insulation Victoria team");
  }
});