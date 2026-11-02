// One-off (Jo 2 Nov 2026, HV-2730): save the OK to share details for owners whose quick-taps "Yes, let's go" was
// recorded while the database refused the OK. Dry run by default; `--apply` writes. Only run on live with Jo's OK,
// after docs/pending-migrations/quick-tap-link-signing.sql is applied.
// Usage: bun scripts/repair-quick-taps-sharing.ts [--apply]
import { repairQuickTapsSharing } from "../src/lib/quick-taps.server";

const apply = process.argv.includes("--apply");
const rows = await repairQuickTapsSharing({ apply });
console.log(`${apply ? "Saved" : "Would save"} ${rows.length} OK(s):`);
for (const r of rows) console.log(`- job ${r.jobId}: ${r.name} (batch ${r.batchId})`);
