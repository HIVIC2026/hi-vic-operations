// Renders the decision 386 DRAFT automatic owner replies O76a–O76j (one short kit email per standard answer, awaiting
// Jo's approval: OWNER_EMAIL_AUTO_REPLY_APPROVED = false) into docs/templates/drafts with the fixed sample data in
// owner-email-auto-reply.core (ANSWER_SAMPLES), and prints each subject + text. Pure renderer only; nothing is sent.
// Run: bun scripts/render-decision-386-drafts.ts
import { writeFileSync } from "node:fs";
import { ANSWER_CODES, ANSWER_TYPES, renderAnswerSample } from "../src/lib/owner-email-auto-reply.core";

const DIR = new URL("../docs/templates/drafts/", import.meta.url).pathname;
for (const answer of ANSWER_TYPES) {
  const m = renderAnswerSample(answer);
  writeFileSync(`${DIR}${ANSWER_CODES[answer].file}`, m.html);
  if (import.meta.main) console.log(`--- ${ANSWER_CODES[answer].code} ${ANSWER_CODES[answer].name} — subject: ${m.subject}\n${m.text}\n`);
}
