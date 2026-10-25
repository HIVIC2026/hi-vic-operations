// Renders the decision-244 sample reply drafts into docs/templates/office/email-reply-samples.md for Jo.
// Pure: no network, no database. Usage: bun scripts/render-email-reply-samples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { composeReply, draftCategories, REPLY_TYPE_LABEL } from "../src/lib/email-reply.core";
import { SAMPLES } from "../tests/fixtures/email-reply-samples";

const out: string[] = [
  `# Inbox reply drafts — ${SAMPLES.length} samples for approval (decision 244)`,
  "",
  "Drafts only: the portal writes these into info@ as Outlook drafts in the same thread; Jo or Chris presses Send. Nothing is sent automatically (each type stays manual until Jo switches it on).",
  "Matched owners' replies point to their own homeowner page, never the calculator. Decision 292 (replaces 255 for new senders): a NEW sender with no job is not drafted for and no enquiry is created from their email — they are sent the one website reply (O70, docs/templates/owner/O70-new-sender-calculator.html) pointing to the calculator; every other unmatched email waits on Needs me › Match this email.",
  "Every name, address, job number, link and email below is invented. Figures follow the approved O18 quote example.",
  "",
];
for (const s of SAMPLES) {
  const d = composeReply(s.input);
  if (!d) throw new Error(`Sample ${s.key} produced no draft`);
  if (d.type !== s.key) throw new Error(`Sample ${s.key} picked ${d.type}`);
  out.push(`## ${REPLY_TYPE_LABEL[d.type]} — ${s.title}`, "", `**Incoming email** (from ${s.email.fromName} <${s.email.from}>, subject “${s.email.subject}”):`, "",
    ...s.email.body.split("\n").map((l) => `> ${l}`), "", `**Draft reply** (Outlook categories: ${draftCategories(d).join(", ")}):`, "", "```text", d.text, "```", "",
    `Check before sending: ${d.checkBeforeSending ? `yes — ${d.flags.join("; ")}` : "no"}`, "");
}
mkdirSync("docs/templates/office", { recursive: true });
writeFileSync("docs/templates/office/email-reply-samples.md", out.join("\n"));
console.log(out.join("\n"));
