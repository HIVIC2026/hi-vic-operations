import { expect, test } from "bun:test";
import { renderOwnerQuoteEmail } from "../src/lib/owner-quote-email.core";

test("HV-3666 keeps its $210 rebate once and preserves its $5,988 total", () => {
  const email = renderOwnerQuoteEmail({
    firstName: "Tim", address: "115 Collins Street, Melbourne",
    totalIncGst: 5988, subtotalIncGst: 6198, rebateIncGst: 210,
    lines: [{ description: "Ceiling insulation", lineTotalIncGst: 5500 },
      { description: "PIESA", lineTotalIncGst: 349 },
      { description: "Accredited Person fee", lineTotalIncGst: 349 }],
    quoteUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/test",
    validUntil: null, officePhone: null, unsubscribeUrl: null,
  });
  for (const body of [email.html, email.text]) {
    expect(body.match(/\$210(?:\.00)?/g)).toHaveLength(1);
    expect(body).toContain("$5,988.00");
    expect(body).toContain("$6,198.00");
  }
  expect(email.subject).not.toContain("$210");
});