// Renders the decision 292 sample "O70 – New sender: start on the calculator" reply (the one email a NEW sender gets
// instead of an enquiry; route and wording approved by Jo on 25 Oct 2026) into docs/templates/owner with the fixed
// sample data used by tests/new-sender-reply.test.ts, and prints the subject + text. Pure renderer only; nothing is
// sent. Run: bun scripts/render-decision-292-sample.ts
import { writeFileSync } from "node:fs";
import { renderNewSenderReplyEmail } from "../src/lib/new-sender-reply-email.core";
import { NEW_SENDER_REPLY_TEMPLATE_TITLE } from "../src/lib/new-sender-reply.core";

const DIR = new URL("../docs/templates/owner/", import.meta.url).pathname;
export const O70_SAMPLE = { theirSubject: "Ceiling insulation quote", firstName: "Sam" };
const m = renderNewSenderReplyEmail(O70_SAMPLE);
writeFileSync(`${DIR}O70-new-sender-calculator.html`, m.html);
if (import.meta.main) console.log(`--- ${NEW_SENDER_REPLY_TEMPLATE_TITLE} — subject: ${m.subject}\n${m.text}\n`);
