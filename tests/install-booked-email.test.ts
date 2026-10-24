// Jo 24 Oct (decisions 43–46): "Your install is booked" owner email.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALL_BOOKED_EMAIL_APPROVED, renderInstallBookedEmail } from "../src/lib/install-booked-email.core";

const base = { firstName: "Helen", when: "Tuesday 27 October at 7:30am", address: "824 High Street Road, Glen Waverley VIC 3150", installerName: "Reinsulate", installerPhone: "0400 000 000", removal: false, myJobUrl: "https://example.test/my-job/t" };

test("day and time, installer with phone, what to do, link", () => {
  const m = renderInstallBookedEmail(base);
  expect(m.subject).toBe("Your insulation install is booked – Tuesday 27 October at 7:30am");
  for (const b of [m.text]) {
    expect(b).toContain("When: Tuesday 27 October at 7:30am");
    expect(b).toContain("Installer: Reinsulate, 0400 000 000");
    expect(b).toContain("YOUR POWER WILL BE OFF");
    expect(b).toContain("Clear the area under the ceiling hatch and a path to it");
    expect(b).toContain("See my job: https://example.test/my-job/t");
    expect(b).not.toContain("expect some dust");
  }
  // Decision 98 design (O35): date card with the arrival time, power-off box, "On the day" ticks, Change day.
  expect(m.html).toContain("Your install is booked, Helen");
  expect(m.html).toContain(">Tuesday 27 October<");
  expect(m.html).toContain(">Arriving 7:30am<");
  expect(m.html).toContain("Your power will be off");
  expect(m.html).toContain("<strong>Change day</strong>");
});

test("removal jobs warn about dust", () => {
  expect(renderInstallBookedEmail({ ...base, removal: true }).text).toContain("Old insulation is being removed, so expect some dust");
});

test("deposit and balance rows appear only with a payment record (decision 132)", () => {
  const m = renderInstallBookedEmail({ ...base, consentSigned: true, payment: { depositPaid: 185.1, cardLast4: "4242", balanceDue: 1665.9, payInFullUrl: "https://example.test/pay" } });
  expect(m.html).toContain("Consent signed and deposit received ✓");
  expect(m.html).toContain("$185.10");
  expect(m.html).toContain("$1,665.90");
  expect(m.html).toContain(">Pay in full<");
  expect(renderInstallBookedEmail(base).html).not.toContain("Deposit paid");
});

test("held until Jo approves; sent after booking, best-effort, one per booked time", () => {
  expect(INSTALL_BOOKED_EMAIL_APPROVED).toBe(false);
  const srv = readFileSync("src/lib/install-booked-email.server.ts", "utf8");
  expect(srv).toContain("assertCustomerDeliveryAllowed");
  expect(srv).toContain("install-booked:v1:${jobId}:${startIso}");
  expect(readFileSync("src/lib/install-days.server.ts", "utf8")).toMatch(/emailOwnerInstallBooked\(jobId, startsAt\)\.catch/);
});
