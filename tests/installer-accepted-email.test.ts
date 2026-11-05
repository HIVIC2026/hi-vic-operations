// Jo 24 Oct (decision 4): email the installer once the owner has accepted AND paid the safety check (moved from acceptance, Jo 28 Oct 2026). Install days: installer offers 3, owner picks or suggests others, back and forth (Jo 24 Oct, later).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderInstallerAcceptedEmail } from "../src/lib/installer-accepted-email.core";

test("wording Jo approved, install days installer-first (to confirm in template review), and no prices", () => {
  const m = renderInstallerAcceptedEmail({ installerFirstName: "Deep", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-3117", jobUrl: "https://estimate.homeinsulationvictoria.com.au/field/j" , useV2: false });
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
  expect(srv).toContain("youreInDue(");
  expect(srv).toContain("safetyCheckPaidAt(");
  expect(srv).toContain("v.invoiceId !== invoiceId");
  expect(srv).toMatch(/status\s*!==\s*"accepted"/);
  const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
  const acc = pf.slice(pf.indexOf("async function invoiceAfterAcceptance"), pf.indexOf("// ---------- Payments"));
  expect(acc).not.toContain("emailInstallerQuoteAccepted");
  const pay = readFileSync("src/lib/payments.server.ts", "utf8");
  const branch = pay.slice(pay.indexOf('if (isStepPaid(v.steps, "safety_check"))'), pay.indexOf("if (v.due.remainingCents === 0"));
  expect(branch).toContain("emailInstallerOnSafetyCheckPaid(jobId, v.invoiceId)");
  expect(branch).toContain('console.error("installer accepted email skipped"');
});

// Decision #36 (Jo 2 Nov 2026): the approved "Owner accepted" office email — behind INSTALLER_ACCEPTED_V2_APPROVED.
import { INSTALLER_ACCEPTED_V2_APPROVED } from "../src/lib/installer-accepted-email.core";
const unesc = (s: string) => s.replace(/&#39;|&#x27;/g, "'");
const v2Job = { installerFirstName: "Deep", ownerName: "Sarah Lee", address: "1 Example St, Sampletown", jobNumber: "HV-3117", jobUrl: "https://estimate.homeinsulationvictoria.com.au/field/j", useV2: true };

test("#36 flag ON since 5 Nov 2026 (Jo: all designed templates on); the old wording stays reachable with useV2: false", () => {
  expect(INSTALLER_ACCEPTED_V2_APPROVED).toBe(true);
  const m = renderInstallerAcceptedEmail({ ...v2Job, useV2: false });
  expect(m.text).toContain("Offer Sarah 3 install days");
  expect(m.text).not.toContain("Book the PIESA");
});

test("#36 office books: approved wording, no price at all (pack 1 items 13/14, Jo 4 Nov 2026: installers never see Home Insulation Victoria's PIESA price)", () => {
  const m = renderInstallerAcceptedEmail({ ...v2Job, whoBooks: "office", electricianName: null });
  expect(m.subject).toBe("Owner accepted – HV-3117, 1 Example St, Sampletown");
  expect(m.html).toContain("Book the PIESA now.");
  for (const b of [unesc(m.html), unesc(m.text)]) {
    expect(b).toContain("has paid for the PIESA.");
    expect(b).not.toContain("$349");
    expect(b).toContain("Book the PIESA");
    expect(b).toContain("Pick your electrician on the job, call Sarah, then add the day and time in the portal within 2 business days.");
    expect(b).toContain("Electrical upgrades, if needed");
    expect(b).toContain("Quote, book and invoice them with Sarah directly. Upload the Part C and Certificate of Electrical Safety before the install.");
    expect(b).toContain("Book the install");
    expect(b).toContain("Call Sarah and add the install day and Lead Installer in the portal. Sarah pays her 10% deposit to lock it in. Install within 30 days of the PIESA.");
    for (const bad of ["offers", "3 install days", "Nothing for you to do"]) expect(b).not.toContain(bad);
    expect(b.match(/\$[\d,.]+/g) ?? []).toEqual([]); // no dollar figure anywhere on the installer's email
  }
  expect(m.text).toContain("Book the PIESA: Pick your electrician on the job, call Sarah, then add the day and time in the portal within 2 business days.");
});

test("#36 electrician books: names the electrician", () => {
  const m = renderInstallerAcceptedEmail({ ...v2Job, whoBooks: "electrician", electricianName: "Viking Electrical" });
  expect(m.text).toContain("Book the PIESA: Viking Electrical will call Sarah to book it.");
  expect(m.text).not.toContain("Pick your electrician");
});

test("#36 'either' and a missing who-books are treated as the office books", () => {
  for (const w of ["either", undefined] as const) {
    const m = renderInstallerAcceptedEmail({ ...v2Job, whoBooks: w });
    expect(m.text).toContain("Pick your electrician on the job, call Sarah");
  }
});
