// Renders the decision 291 sample emails into docs/templates/owner (O69) and docs/templates/installer (I70) with the fixed sample
// data used by tests/approved-email-designs.test.ts, and prints subjects + text. Pure renderers only; nothing is sent.
// Run: bun scripts/render-decision-291-samples.ts
import { writeFileSync } from "node:fs";
import { renderInstallerCancelledEmail, renderOwnerCancelledEmail } from "../src/lib/cancel-notice.core";

const DIR = new URL("../docs/templates/owner/", import.meta.url).pathname;
const INSTALLER_DIR = new URL("../docs/templates/installer/", import.meta.url).pathname;
/** Sample office number for the design files only; the live number comes from env HIV_OFFICE_PHONE. */
export const SAMPLE_OFFICE_PHONE = "03 9000 0000";

export const O69_SAMPLE = { firstName: "Helen", jobNumber: "HV-3117", address: "824 High Street Road, Glen Waverley VIC 3150", officePhone: SAMPLE_OFFICE_PHONE };
export const I70_SAMPLE = { jobNumber: "HV-3117", place: "824 High Street Road, Glen Waverley", officePhone: SAMPLE_OFFICE_PHONE };

const o69 = renderOwnerCancelledEmail(O69_SAMPLE);
const i70 = renderInstallerCancelledEmail(I70_SAMPLE);
writeFileSync(`${DIR}O69-job-cancelled.html`, o69.html);
writeFileSync(`${INSTALLER_DIR}I70-job-cancelled.html`, i70.html);

if (import.meta.main) {
  console.log(o69.subject, "\n--- O69 text\n" + o69.text);
  console.log("\n" + i70.subject, "\n--- I70 text\n" + i70.text);
}
