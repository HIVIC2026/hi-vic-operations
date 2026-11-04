// Jo 7 Oct: owners accept the office-released measured quote at measured_estimate_ready; the older path still works.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/lib/portal.functions.ts", import.meta.url), "utf8");
// Formatter-tolerant: prettier re-wrapped the function (arrays and calls across lines), so the pins read a one-space form.
const impl = src.slice(src.indexOf("export async function respondToQuoteImpl"), src.indexOf("// ---------- Payments")).replace(/\s+/g, " ").replace(/\[ /g, "[").replace(/, \]/g, "]").replace(/\( /g, "(").replace(/, \)/g, ")");
test("both installation stages accept; a fixes quote is answered at the stages it is sent from (decision 366)", () => {
  expect(impl).toContain('["awaiting_quote_acceptance", "measured_estimate_ready"]');
  expect(impl).toContain('["awaiting_owner_rectification_approval", "piesa_complete", "electrical_variation_pending", "rectification_required", "rectification_scheduling", "rectification_booked"]');
});
test("measured path moves to measured_quote_accepted only after every guard", () => {
  const at = (s: string) => impl.indexOf(s);
  const move = at('transition(q.job_id, "measured_quote_accepted"');
  expect(move).toBeGreaterThan(0);
  for (const g of ["expectedVersion !== q.version", "quoteIsExpired", "assertAgreementCanSign", "commercialBlocker", "signCustomerAgreement", 'status: "accepted"'])
    expect(at(g)).toBeGreaterThan(0), expect(at(g)).toBeLessThan(move);
  expect(at('"awaiting_deposit_payment"')).toBeGreaterThan(move); // legacy path kept
});
test("owner My job shows the accept button at both stages", () => {
  const my = readFileSync(new URL("../src/lib/owner-myjob.server.ts", import.meta.url), "utf8");
  expect(my).toContain('stage === "awaiting_quote_acceptance" || stage === "measured_estimate_ready"');
});
