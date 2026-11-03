// Part 3 Task 16/18: how many REAL jobs are still at an old pre-acceptance step. READ-ONLY (selects only, writes nothing).
// Usage: bun scripts/old-flow-inflight-count.ts [--business <id>]    (--business counts one installer's jobs only)
// Reads (through the service client; run it in a place that already has the portal's environment): proposed future
// Ready Check times, run-slot events, then jobs / job_assignments to keep real, live jobs only (see old-flow-inflight.server.ts).
// A step with a non-zero count: those jobs keep the old way (their old screen still shows); do not move that installer
// onto the new flow until they finish. Exit 0 always (it only reports).
import { oldStepJobs } from "../src/lib/old-flow-inflight.server";

const bi = process.argv.indexOf("--business");
const businessId = bi >= 0 ? process.argv[bi + 1] : undefined;
if (bi >= 0 && !businessId) { console.error("--business needs an id"); process.exit(1); }
const steps = await oldStepJobs(businessId);
console.log(`Real jobs still at an old pre-acceptance step${businessId ? ` for business ${businessId}` : ""} (test jobs, deleted and cancelled jobs left out)`);
console.log("Step".padEnd(36), "Jobs");
let total = 0;
for (const s of steps) { total += s.count; console.log(s.step.padEnd(36), String(s.count).padEnd(4), s.jobNumbers.join(", ")); }
console.log(total === 0 ? "None: the old screens only ever show for a job at one of these steps, so removing them strands nobody." : `${total} real job(s) at an old step: leave them on the old way (their old screen still shows) and ask Jo before moving that installer.`);
