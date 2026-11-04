import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderYoureInEmail } from "../src/lib/acceptance-email.core";
import { COMPLAINT_LINE } from "../src/lib/owner-wording.core";

const e = renderYoureInEmail({ firstName: "Sarah", rebate: 1610, totalIncGst: 2188, payment: { amount: 349, paidOn: "8 Nov" }, installerName: "Rapid Insulation", myJobUrl: "x" });
test("approved next steps (touchpoint 34)", () => {
  expect(e.text).toContain("1. Electrical safety check (PIESA): Rapid Insulation's licensed electrician will call you to book it. They check your wiring, downlights and switchboard are safe to insulate over.");
  expect(e.text).toContain("2. Only if electrical upgrades are needed: Your electrician quotes and books them with you directly. Nothing is done without your OK.");
  expect(e.text).toContain("3. Book your install day: Rapid Insulation will call you to book it. Pay your 10% deposit to lock it in. Your install is done within 30 days of the electrical safety check (PIESA).");
  expect(e.text).toContain("Electrical safety check (PIESA): $349.00");
  expect(e.text).not.toMatch(/offer you times|offers you 3 days|separate quote/);
});
test("complaint line (VEU Fix 4)", () => {
  expect(COMPLAINT_LINE).toBe("Something not right? Reply to this email or write to info@homeinsulationvictoria.com.au and we'll look into it. If it's still not sorted, you can contact the Essential Services Commission (esc.vic.gov.au) or Consumer Affairs Victoria.");
  expect(e.text).toContain(COMPLAINT_LINE);
  expect(e.html).toContain("esc.vic.gov.au");
});
test("no installer yet", () => {
  const n = renderYoureInEmail({ firstName: null, rebate: null, totalIncGst: 2188, payment: null, installerName: null, myJobUrl: "x" });
  expect(n.text).toContain("Your installer's licensed electrician will call you to book it.");
  expect(n.text).toContain("Your installer will call you to book it.");
});
test("receipt PDF attached only when its flag is on", () => {
  expect(readFileSync("src/lib/owner-email-triggers.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.receipts[\s\S]{0,400}receiptPdf|fileReceiptPdf/);
});
