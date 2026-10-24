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
    expect(b).toContain("sign your install consent at least 24 hours before");
    expect(b).toContain("clear the area under the ceiling hatch");
    expect(b).toContain("Open my job: https://example.test/my-job/t");
    expect(b).not.toContain("extra dust");
  }
});

test("removal jobs warn about dust and a longer day", () => {
  expect(renderInstallBookedEmail({ ...base, removal: true }).text).toContain("extra dust and a longer day");
});

test("held until Jo approves; sent after booking, best-effort, one per booked time", () => {
  expect(INSTALL_BOOKED_EMAIL_APPROVED).toBe(false);
  const srv = readFileSync("src/lib/install-booked-email.server.ts", "utf8");
  expect(srv).toContain("assertCustomerDeliveryAllowed");
  expect(srv).toContain("install-booked:v1:${jobId}:${startIso}");
  expect(readFileSync("src/lib/install-days.server.ts", "utf8")).toMatch(/emailOwnerInstallBooked\(jobId, startsAt\)\.catch/);
});
