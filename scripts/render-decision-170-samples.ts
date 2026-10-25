// Renders the decision 170 sample emails into docs/templates/owner (O63, O64) and docs/templates/installer (I62) with the fixed sample data used by
// tests/approved-email-designs.test.ts. Pure renderers only; nothing is sent. Run: bun scripts/render-decision-170-samples.ts
import { writeFileSync } from "node:fs";
import { renderConsentCopyEmail } from "../src/lib/consent-copy-email.core";
import { depositReleaseText, renderDepositReleasedEmail } from "../src/lib/deposit-release-notice.core";
import { collectionNoticeEmail } from "../src/lib/esc-collection-notice.core";
import { partnerEmailLayout } from "../src/lib/partner-email.core";
import { HIV_BANK_DETAILS, bankDetailLines } from "../src/lib/payments.core";
import { brandSmsBody } from "../src/lib/sms.core";

const DIR = new URL("../docs/templates/owner/", import.meta.url).pathname;
const INSTALLER_DIR = new URL("../docs/templates/installer/", import.meta.url).pathname;
const JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const SAMPLE_CONSENT_FORM = [
  "Section 1: Information to be shared", "First Name: Helen", "Last Name: Yang", "Address of premises: 824 High Street Road, Glen Waverley VIC 3150", "Installation day(s): Tuesday 11 November 2026", "",
  "Section 2: Owner declarations", "☑ I consent to the Accredited Person sharing this information with the Essential Services Commission", "☑ I understand the information is used to verify the installation and the VEEC claim", "☑ I am the owner or authorised representative of the premises", "☑ I have read and understood this form", "",
  "Owner signature: Helen Yang  Date: 24 October 2026", "AP representative: Jo Carter (Director)  Date: 24 October 2026",
].join("\n");

const o63 = renderConsentCopyEmail({ firstName: "Helen", installationDays: ["2026-11-11"], address: "824 High Street Road, Glen Waverley VIC 3150", templateVersion: "esc-2026-10-v1", formText: SAMPLE_CONSENT_FORM, sha256: "e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151", myJobUrl: JOB, attached: true });
writeFileSync(`${DIR}O63-consent-copy.html`, o63.html);
const o64 = renderDepositReleasedEmail({ firstName: "Helen", day: "Tuesday 11 November", link: JOB, depositAmount: "$185.10", bankLines: bankDetailLines(HIV_BANK_DETAILS, "Home Insulation Victoria HV-3117") });
writeFileSync(`${DIR}O64-deposit-released.html`, o64.html);
const n = collectionNoticeEmail({ firstName: "Sam", acknowledgedAt: "2026-10-24T01:00:00.000Z" });
const i62 = partnerEmailLayout({ subject: n.subject, heading: n.heading, blocks: n.blocks, test: false });
writeFileSync(`${INSTALLER_DIR}I62-notice-copy.html`, i62.html);

if (import.meta.main) {
  console.log(o63.subject, "|", o64.subject, "|", n.subject);
  const t = brandSmsBody(depositReleaseText({ firstName: "Helen", day: "Tuesday 11 November", link: JOB }));
  console.log(t, t.length);
  console.log("--- O64 text\n" + o64.text);
  console.log("--- I62 text\n" + i62.text.slice(0, 900));
}
