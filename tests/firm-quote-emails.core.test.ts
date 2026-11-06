import { expect, test } from "bun:test";
import { preliminaryEstimateEmail, firmQuoteOnItsWayEmail, firmQuoteReadyEmail } from "../src/lib/firm-quote-emails.core";

const estimate = { firstName: "Alex", price: 2940, rebate: 1610, fullPrice: 4550, areaM2: 150, insulation: "present" as const, removalRatePerM2: 15, proceedUrl: "https://example.test/estimate/test-token/firm-quote" };
const ready = { firstName: "Alex", price: 3390, rebate: 1530, fullPrice: 4920, ownerM2: 150, confirmedM2: 142, removalM2: 40, removalRatePerM2: 15, validUntil: "2026-12-20", acceptUrl: "https://example.test/my-job/test-token" };

test("preliminary estimate subject uses caller amounts", () => expect(preliminaryEstimateEmail(estimate).subject).toBe("Alex, your preliminary estimate: $2,940 after a $1,610 rebate"));
test("preliminary estimate has the approved action and promises in both twins", () => {
  const email = preliminaryEstimateEmail(estimate);
  expect(email.previewText).toBe("Happy with it? Press Proceed to firm quote.");
  for (const body of [email.html, email.plainText]) {
    expect(body).toContain("Proceed to firm quote");
    expect(body).toContain("within 7 business days");
    expect(body).toContain("Nothing is locked in until you accept your firm quote.");
    for (const retired of ["Save my", "spot", "Ready Check", "preliminary quote", "call us"]) expect(body).not.toContain(retired);
    expect(body).not.toMatch(/\babout \$/i);
  }
});
test("existing-insulation removal card for present", () => {
  const email = preliminaryEstimateEmail(estimate);
  expect(email.html).toContain("Your existing insulation");
  expect(email.plainText).toContain("YOUR EXISTING INSULATION");
});
test("existing-insulation removal card for unknown", () => expect(preliminaryEstimateEmail({ ...estimate, insulation: "unknown" }).html).toContain("Your existing insulation"));
test("no removal card for no existing insulation", () => {
  const email = preliminaryEstimateEmail({ ...estimate, insulation: "none" });
  expect(email.html).not.toContain("Your existing insulation");
  expect(email.plainText).not.toContain("YOUR EXISTING INSULATION");
});
test("estimate removal rate and total come from caller", () => {
  const email = preliminaryEstimateEmail({ ...estimate, removalRatePerM2: 12 });
  for (const body of [email.html, email.plainText]) {
    expect(body).toContain("$12/m²");
    expect(body).toContain("$1,800");
    expect(body).not.toContain("$15/m²");
  }
});
test("estimate plain text mirrors rebate, price, full price and owner area", () => {
  const email = preliminaryEstimateEmail(estimate);
  for (const body of [email.html, email.plainText]) {
    for (const line of ["You save $1,610", "$2,940", "$4,550", "Based on your 150 m² ceiling estimate"]) expect(body).toContain(line);
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
test("names, price and proceed link are caller inputs", () => {
  const email = preliminaryEstimateEmail({ ...estimate, firstName: "Sam", price: 3000, proceedUrl: "https://example.test/new-request" });
  expect(email.subject).toBe("Sam, your preliminary estimate: $3,000 after a $1,610 rebate");
  for (const body of [email.html, email.plainText]) {
    expect(body).toContain("Sam, your preliminary estimate is ready");
    expect(body).toContain("https://example.test/new-request");
  }
});
test("every twin carries the approved full-brand sign-off", () => {
  for (const email of [preliminaryEstimateEmail(estimate), firmQuoteOnItsWayEmail({ firstName: "Alex", dueDate: "2026-11-20" }), firmQuoteReadyEmail(ready)]) {
    for (const body of [email.html, email.plainText]) expect(body).toContain("Cheers, the Home Insulation Victoria team");
  }
});