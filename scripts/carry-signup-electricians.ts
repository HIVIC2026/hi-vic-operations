// One-off (Jo, 29 Oct 2026): keep the electrician each approved installer named at sign-up as their usual electrician
// (expected today: Rapid -> Viking Electrical, Matthews -> Tudor Electrical). Sends nothing; the invite sweep sends on its next tick.
// Run: bun ./scripts/carry-signup-electricians.ts --dry-run   (prints only)   |   bun ./scripts/carry-signup-electricians.ts
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";
import { carrySignupElectrician } from "../src/lib/signup-electrician.server";
import { signupMainElectrician } from "../src/lib/signup-electrician.core";
import { readUsualElectrician } from "../src/lib/usual-electrician.server";

const dryRun = process.argv.includes("--dry-run");
const { data: acts, error } = await admin.from("partner_activations").select("business_id, application_id").not("business_id", "is", null).not("application_id", "is", null);
if (error) { console.error(`Could not read activations: ${error.message}`); process.exit(1); }
const ids = [...new Set((acts ?? []).map((a) => a.business_id as string))];
const { data: bizs, error: be } = ids.length ? await admin.from("businesses").select("id, name, onboarding_status").in("id", ids).eq("onboarding_status", "approved") : { data: [], error: null };
if (be) { console.error(`Could not read businesses: ${be.message}`); process.exit(1); }

let saved = 0;
for (const b of bizs ?? []) {
  const appId = (acts ?? []).find((a) => a.business_id === b.id)?.application_id as string;
  const { data: app } = await admin.from("rec_onboarding_applications").select("data").eq("id", appId).maybeSingle();
  const e = signupMainElectrician(app?.data);
  if (dryRun) {
    const already = e ? !!(await readUsualElectrician(b.id)).electrician : false;
    console.log(`${b.name}: ${e ? `${e.name} (${e.licence})${already ? " - already saved, would only link nominations" : " - would save"}` : "nothing to carry"}`);
    continue;
  }
  const r = await carrySignupElectrician(b.id, null);
  if (r.saved) saved++;
  console.log(`${b.name}: ${r.saved ? "saved" : `not saved (${r.reason})`}`);
}
console.log(dryRun ? "Dry run only - nothing changed." : `Done. Saved ${saved}.`);
