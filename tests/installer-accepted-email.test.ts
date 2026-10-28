// Jo 24 Oct (decision 4): email the installer once the owner has accepted AND paid the safety check (moved from acceptance, Jo 28 Oct 2026). Install days: installer offers 3, owner picks or suggests others, back and forth (Jo 24 Oct, later).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderInstallerAcceptedEmail } from "../src/lib/installer-accepted-email.core";

test("wording Jo approved, install days installer-first (to confirm in template review), and no prices", () => {
  const m = renderInstallerAcceptedEmail({ installerFirstName: "Deep", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-3117", jobUrl: "https://estimate.homeinsulationvictoria.com.au/field/j" });
  expect(m.subject).toBe("Owner accepted – HV-3117, 824 High Street Road, Glen Waverley");
  // Decision 91 design (I23): "Good news, Deep. Helen accepted!", three next steps, Open the job.
  expect(m.text).toContain("Hi Deep,");
  expect(m.text).toContain("Good news, Deep. Helen accepted!");
  expect(m.html).toContain(">Good news, Deep.<");
  expect(m.html).toContain(">Helen accepted!<");
  for (const b of [m.html, m.text]) {
    expect(b).toContain("has paid for the electrical safety check");
    expect(b).toContain("Offer Helen 3 install days");
    expect(b.replace(/&#39;|&#x27;/g, "'")).toContain("Helen picks one and it's booked, or suggests other days, until you agree.");
    expect(b).not.toContain("sort it out");
    expect(b).toContain("Install within 30 days of the safety check");
  }
  expect(m.text).toContain("Helen Yang has accepted the quote for 824 High Street Road, Glen Waverley (HV-3117)");
  expect(m.html).toContain(">Open the job<");
  expect(m.text).not.toMatch(/\$\d/); // never the owner's price
  expect(m.html).not.toContain("TEST — only sent to Jo");
});

test("sent once per quote only when the safety check is paid — never at acceptance (Jo 28 Oct 2026)", () => {
  const srv = readFileSync("src/lib/installer-accepted-email.server.ts", "utf8");
  expect(srv).toContain('eq("event_type", "installer_accepted_email").contains("details", { quote_id: quoteId })');
  expect(srv).toContain("sendOfficeEmail(");
  expect(srv).toContain("sendTestEmail(");
  expect(srv).toContain("export async function emailInstallerOnSafetyCheckPaid(jobId: string, invoiceId: string)");
  expect(srv).toMatch(/status\s*!==\s*"accepted"/);
  const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
  const acc = pf.slice(pf.indexOf("async function invoiceAfterAcceptance"), pf.indexOf("// ---------- Payments"));
  expect(acc).not.toContain("emailInstallerQuoteAccepted");
  const pay = readFileSync("src/lib/payments.server.ts", "utf8");
  const branch = pay.slice(pay.indexOf('if (isStepPaid(v.steps, "safety_check"))'), pay.indexOf("if (v.plan.fixesCents > 0"));
  expect(branch).toContain("emailInstallerOnSafetyCheckPaid(jobId, invoiceId)");
  expect(branch).toContain('console.error("installer accepted email skipped"');
});
