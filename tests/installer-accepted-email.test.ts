// Jo 24 Oct (decision 4): email the installer when the owner accepts. Install days: installer offers 3, owner picks or suggests others, back and forth (Jo 24 Oct, later).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderInstallerAcceptedEmail } from "../src/lib/installer-accepted-email.core";

test("wording Jo approved, install days installer-first (to confirm in template review), and no prices", () => {
  const m = renderInstallerAcceptedEmail({ installerFirstName: "Deep", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-3117", jobUrl: "https://estimate.homeinsulationvictoria.com.au/field/j" });
  expect(m.subject).toBe("Owner accepted – HV-3117, 824 High Street Road, Glen Waverley");
  for (const b of [m.html, m.text]) {
    expect(b).toContain("Hi Deep,");
    expect(b).toContain("Helen Yang has accepted the quote for 824 High Street Road, Glen Waverley (HV-3117)");
    expect(b.replace(/&#39;|&#x27;/g, "'")).toContain("offer Helen 3 install days. Helen picks one and it's booked, or suggests other days");
    expect(b).not.toContain("sort it out");
    expect(b).toContain("within 30 days of the safety check");
  }
  expect(m.text).not.toMatch(/\$(?!349)\d/); // only the $349 safety check, never the owner's price
  expect(m.html).not.toContain("TEST — only sent to Jo");
});

test("sent once per quote after acceptance, through the office sender (pauses with the master switch); never blocks acceptance", () => {
  const srv = readFileSync("src/lib/installer-accepted-email.server.ts", "utf8");
  expect(srv).toContain('eq("event_type", "installer_accepted_email").contains("details", { quote_id: quoteId })');
  expect(srv).toContain("sendOfficeEmail(");
  expect(srv).toContain("sendTestEmail(");
  const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
  expect(pf).toContain('catch (e) { console.error("installer accepted email skipped"');
});
