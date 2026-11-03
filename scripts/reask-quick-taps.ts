// One-off (Jo 3 Nov 2026, Mia HV-1405 tapped "flat roof" by mistake): let an owner answer the quick taps again for their
// open batch — sets the old answer aside (history kept), reopens the job, and with --text sends Jo's approved text with
// their existing link. Dry run by default; --apply writes. Only run on live with Jo's OK, right before each run.
// Usage: bun scripts/reask-quick-taps.ts <jobId> <actorUserId> [--apply] [--text]
import { reaskQuickTaps } from "../src/lib/quick-taps.server";

const [jobId, actorId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!jobId || !actorId) { console.error("Usage: bun scripts/reask-quick-taps.ts <jobId> <actorUserId> [--apply] [--text]"); process.exit(1); }
const apply = process.argv.includes("--apply");
const sendText = apply && process.argv.includes("--text");
const r = await reaskQuickTaps(jobId, { apply, actorId, sendText });
console.log(apply ? "Done:" : "Dry run — would:");
console.log(`- batch ${r.batchId}: set aside ${r.setAside} old answer(s)`);
console.log(`- reopen: ${r.reopened ? "yes" : "no (not cancelled)"} · stage now ${r.stage}`);
console.log(`- text to ${r.to} with link ${r.link}: ${r.texted ?? (process.argv.includes("--text") ? "would send" : "not asked")}`);
