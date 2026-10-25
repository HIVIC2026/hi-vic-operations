// Renders the decision 363 DRAFT owner email O73 "Your insulation warranty" (sent once, with the manufacturer warranty
// PDF attached, when a warranty that was not on file at the completion pack is added later) into docs/templates/drafts
// with fixed sample data, and prints the text for Jo's approval. Pure renderer only; nothing is sent. Once approved, move
// the HTML to docs/templates/approved and set WARRANTY_FOLLOWUP_APPROVED to true (src/lib/warranty-followup.core.ts).
// Run: bun scripts/render-decision-363-drafts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { renderWarrantyFollowupEmail } from "../src/lib/warranty-followup.core";

const DIR = new URL("../docs/templates/drafts/", import.meta.url).pathname;
export const O73_SAMPLE = { firstName: "Helen", products: ["Bradford Gold"], unsubscribeUrl: null };
export const O73_FILE = "O73-warranty-followup.html";

mkdirSync(DIR, { recursive: true });
const m = renderWarrantyFollowupEmail(O73_SAMPLE);
writeFileSync(`${DIR}${O73_FILE}`, m.html);
if (import.meta.main) console.log(`--- O73 (warranty follow-up, PDF attached) — subject: ${m.subject}\n${m.text}\n`);
