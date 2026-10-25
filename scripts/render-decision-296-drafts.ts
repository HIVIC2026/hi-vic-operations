// Renders the decision 296 DRAFT owner email O71 "Confirm your electrical safety check" (request + reminder variants) into
// docs/templates/drafts with fixed sample data (Helen, Sam Spark of Spark Electrical, all clear, 24 October 2026) and prints
// the text + the two SMS bodies for Jo's approval. Pure renderer only; nothing is sent. Once approved, move the HTML to
// docs/templates/approved, set PIESA_OWNER_CONFIRM_EMAIL_APPROVED to true and `piesa_owner_confirm.wordingApproved` to true.
// Run: bun scripts/render-decision-296-drafts.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { piesaOwnerConfirmReminderText, piesaOwnerConfirmRequestText } from "../src/lib/piesa-owner-confirm.core";
import { renderPiesaOwnerConfirmEmail } from "../src/lib/piesa-owner-confirm-email.core";

const DIR = new URL("../docs/templates/drafts/", import.meta.url).pathname;
export const O71_SAMPLE = { firstName: "Helen", assessmentDate: "24 October 2026", electricianLine: "Sam Spark (Spark Electrical Pty Ltd)", outcomeKind: "all_clear" as const, confirmUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok", unsubscribeUrl: null };
export const O71_FILES = { request: "O71-piesa-confirm.html", reminder: "O71b-piesa-confirm-reminder.html" } as const;

mkdirSync(DIR, { recursive: true });
for (const reminder of [false, true]) {
  const m = renderPiesaOwnerConfirmEmail({ ...O71_SAMPLE, reminder });
  writeFileSync(`${DIR}${reminder ? O71_FILES.reminder : O71_FILES.request}`, m.html);
  if (import.meta.main) console.log(`--- O71${reminder ? "b (days 1/3 reminder)" : " (request)"} — subject: ${m.subject}\n${m.text}\n`);
}
if (import.meta.main) {
  console.log(`--- SMS piesa_owner_confirm (request): ${piesaOwnerConfirmRequestText(O71_SAMPLE.confirmUrl)}`);
  console.log(`--- SMS piesa_owner_confirm (days 1/3): ${piesaOwnerConfirmReminderText(O71_SAMPLE.confirmUrl)}`);
}
