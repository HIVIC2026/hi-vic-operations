// One-off (Jo 3 Nov 2026, Mia HV-1405 tapped "flat roof" by mistake): let an owner answer the quick taps again — reopens
// the job, moves it out of its old batch into a fresh one for the same installer, and texts Jo's approved wording (no
// email). Their old answer stays in the history. Dry run by default; --apply does it. Only with Jo's OK right before.
// Usage: bun scripts/reask-quick-taps.ts <jobId> <actorUserId> [--apply]
import { reaskQuickTaps } from "../src/lib/quick-taps.server";

const [jobId, actorId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!jobId || !actorId) { console.error("Usage: bun scripts/reask-quick-taps.ts <jobId> <actorUserId> [--apply]"); process.exit(1); }
const apply = process.argv.includes("--apply");
const r = await reaskQuickTaps(jobId, { apply, actorId });
console.log(apply ? "Done:" : "Dry run — would:");
console.log(`- old batch ${r.oldBatchId} (answer: ${r.answered}) for ${r.installer}`);
console.log(`- reopen the job: ${r.reopened ? "yes" : "no (not cancelled)"}`);
console.log(`- fresh batch: ${r.newBatchId ?? "(made on --apply)"} · text: ${r.text ?? "(sent on --apply)"}`);
