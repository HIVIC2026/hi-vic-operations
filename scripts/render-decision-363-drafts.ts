// Renders the decision 363 owner email O73 "Your insulation warranty" (sent once, with the manufacturer warranty
// PDF attached, when a warranty that was not on file at the completion pack is added later) into docs/templates/owner
// with fixed sample data, and prints the text. Pure renderer only; nothing is sent. Approved by Jo (decision 375):
// WARRANTY_FOLLOWUP_APPROVED is true (src/lib/warranty-followup.core.ts).
// Run: bun scripts/render-decision-363-drafts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { renderWarrantyFollowupEmail } from "../src/lib/warranty-followup.core";

const DIR = new URL("../docs/templates/owner/", import.meta.url).pathname;
export const O73_SAMPLE = { firstName: "Helen", products: ["Bradford Gold"], unsubscribeUrl: null };
export const O73_FILE = "O73-warranty-followup.html";

mkdirSync(DIR, { recursive: true });
const m = renderWarrantyFollowupEmail(O73_SAMPLE);
writeFileSync(`${DIR}${O73_FILE}`, m.html);
if (import.meta.main) console.log(`--- O73 (warranty follow-up, PDF attached) — subject: ${m.subject}\n${m.text}\n`);
