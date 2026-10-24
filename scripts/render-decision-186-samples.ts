// Renders the decision 186 sample email into docs/templates/approved (I65) with the fixed sample data used by
// tests/approved-email-designs.test.ts, and prints the text. Pure renderer only; nothing is sent.
// Run: bun scripts/render-decision-186-samples.ts
import { writeFileSync } from "node:fs";
import { installClearanceText, renderInstallClearanceEmail } from "../src/lib/install-clearance.core";
import { brandSmsBody } from "../src/lib/sms.core";

const DIR = new URL("../docs/templates/approved/", import.meta.url).pathname;
const JOB_URL = "https://estimate.homeinsulationvictoria.com.au/field/j";

const i65 = renderInstallClearanceEmail({ jobNumber: "HV-3117", ownerFirstName: "Helen", fixesSignedOff: false, deadlineLabel: "23 November 2026", jobUrl: JOB_URL });
writeFileSync(`${DIR}I65-install-clearance.html`, i65.html);

if (import.meta.main) {
  console.log(i65.subject);
  const t = brandSmsBody(installClearanceText({ jobNumber: "HV-3117", deadlineLabel: "23 November 2026", link: JOB_URL }));
  console.log(t, t.length);
  console.log("--- I65 text\n" + i65.text);
}
