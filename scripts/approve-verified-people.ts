// Decision 402 (Jo 26 Oct 2026), run once for a business the office approved BEFORE the rule existed (e.g. Matthews
// Insulation, activated 26 Oct 10:50): approve the login of every PENDING person on it whose certification is already
// office-verified, through the same helper the business approval now calls (`autoApproveVerifiedPeople`). Rejected,
// removed and unverified people and all electricians are left as they are. Refuses unless the business is approved.
// Usage: bun scripts/approve-verified-people.ts <businessId> [--dry-run] [--actor <office user id>]
//        (actor defaults to the office user who approved the business)
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { autoApproveVerifiedPeople } from "../src/lib/worker-approval.server";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const actorAt = args.indexOf("--actor");
const actorArg = actorAt >= 0 ? args[actorAt + 1] ?? null : null;
const positional = args.filter((a, i) => !a.startsWith("--") && !(actorAt >= 0 && i === actorAt + 1));
const businessId = positional.length === 1 ? positional[0] : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!businessId || !UUID.test(businessId) || (actorArg !== null && !UUID.test(actorArg))) {
  console.error("Usage: bun scripts/approve-verified-people.ts <businessId> [--dry-run] [--actor <office user id>]");
  process.exit(2);
}
const { data: biz, error } = await admin.from("businesses").select("id, name, onboarding_status, approved_by").eq("id", businessId).maybeSingle();
if (error) { console.error(`Could not read the business: ${error.message}`); process.exit(1); }
if (!biz) { console.error("Business not found."); process.exit(1); }
if (biz.onboarding_status !== "approved") { console.error(`REFUSED: ${biz.name} is onboarding_status=${biz.onboarding_status}, not approved. Nothing changed.`); process.exit(1); }

const actor = actorArg ?? biz.approved_by ?? null;
const r = await autoApproveVerifiedPeople(businessId, actor, { dryRun });
console.log(`${dryRun ? "DRY RUN — nothing changed" : "REAL RUN"}: ${biz.name} (${businessId}), actor ${actor ?? "none"}`);
console.log(`${dryRun ? "Would approve" : "Approved"} (${r.approved.length}):`);
for (const p of r.approved) console.log(`  + ${p.name} (${p.role}, ${p.id})`);
console.log(`Left as they are (${r.left.length}):`);
for (const p of r.left) console.log(`  - ${p.name} (${p.role}, ${p.approval}): ${p.reason}`);
if (r.errors.length) { console.log("Errors:"); for (const e of r.errors) console.log(`  ! ${e}`); }
process.exit(r.errors.length ? 1 : 0);
