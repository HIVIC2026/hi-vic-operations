// Jo-approved one-off (23 Oct 2026): send the approved "Spot saved" confirmation ONCE to every real owner who
// saved a spot and never got one. One email + one text per owner (per-owner keys); every guard re-checked.
// Usage: bun scripts/spot-saved-catchup-23oct.ts --dry   (plan only)   |   bun scripts/spot-saved-catchup-23oct.ts
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { sendSpotSavedConfirmation } from "../src/lib/spot-saved-send.server";

const dry = process.argv.includes("--dry");
const { data: rows, error } = await admin.from("lead_campaign_responses").select("job_id, spot_saved_at, jobs!inner(job_number)").not("spot_saved_at", "is", null).order("spot_saved_at");
if (error) throw new Error(error.message);
const tally: Record<string, number> = {};
const lines: string[] = [];
for (const r of rows ?? []) {
  const res = await sendSpotSavedConfirmation(r.job_id, { dry });
  const jn = (r.jobs as { job_number: string | null }).job_number;
  for (const ch of ["email", "sms"] as const) {
    const k = `${ch}: ${res[ch].status}${["skipped", "blocked", "failed", "uncertain", "already"].includes(res[ch].status) ? ` – ${res[ch].detail.slice(0, 90)}` : ""}`;
    tally[k] = (tally[k] ?? 0) + 1;
    if (["failed", "uncertain", "blocked", "sent_unknown"].includes(res[ch].status)) lines.push(`${jn} ${ch} ${res[ch].status}: ${res[ch].detail}`);
  }
  if (!dry) await new Promise((ok) => setTimeout(ok, 600)); // stay well inside provider rate limits
}
console.log(dry ? "DRY RUN — nothing sent" : "REAL RUN");
for (const [k, v] of Object.entries(tally).sort()) console.log(String(v).padStart(4), k);
for (const l of lines) console.log("  ", l);
process.exit(0);
