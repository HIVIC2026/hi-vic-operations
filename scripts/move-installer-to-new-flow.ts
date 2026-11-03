// Part 3 Task 18: move ONE installer onto "installer calls and books" (businesses.in_house).
// DRY RUN BY DEFAULT: prints the checks and what it would do, writes nothing.
//   bun scripts/move-installer-to-new-flow.ts --business <business-id>                      (dry run)
//   bun scripts/move-installer-to-new-flow.ts --business <business-id> --apply --actor <admin-user-id>   (real move)
// The real move calls the existing save_in_house_partner RPC once and writes one admin_config_events row.
// It refuses if the installer is already moved, has no office phone / email / electrician / PIESA rate, or still has real
// jobs at an old step. Order of moves (Part 11): INSolation first, the rest after Jo OKs the real runs.
// Run it only in a place that already has the portal's environment; the person running it decides which database it hits.
import { moveInstallerToNewFlow, previewNewFlowMove } from "../src/lib/new-flow-move.server";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const businessId = arg("--business");
const apply = process.argv.includes("--apply");
const actor = arg("--actor");
if (!businessId) { console.error("Usage: bun scripts/move-installer-to-new-flow.ts --business <id> [--apply --actor <admin-user-id>]"); process.exit(1); }
if (apply && !actor) { console.error("--apply needs --actor <admin-user-id> (the office user the history row is recorded against)"); process.exit(1); }

const p = await previewNewFlowMove(businessId);
console.log(`${p.name} (${businessId})`);
console.log(`  office phone: ${p.facts.officePhone ?? "none"} | email: ${p.facts.email ?? "none"} | electricians: ${p.facts.electricians} | PIESA inc GST: ${p.facts.piesaRateIncGst ?? "none"}`);
for (const s of p.facts.oldStepJobs) console.log(`  real jobs at "${s.step}": ${s.count}`);
if (p.blockers.length) { console.log("CANNOT MOVE:"); for (const b of p.blockers) console.log(`  - ${b}`); process.exit(2); }
if (!apply) { console.log(`DRY RUN: would call save_in_house_partner(in_house=true) for ${p.name} and record one new_flow_moved row. Nothing written.`); process.exit(0); }
const r = await moveInstallerToNewFlow(businessId, actor!);
if (!r.moved) { console.log("REFUSED:"); for (const b of r.blockers) console.log(`  - ${b}`); process.exit(2); }
console.log(`MOVED: ${p.name} is now on the new flow.`);
