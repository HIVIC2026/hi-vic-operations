// Jo-approved one-off (22 Oct 2026): link Mitti Ready Check form 920 (Janet Lyttle, Reinsulate/Deep)
// to the existing enquiry HV-1538 via the normal guarded link path, then record the installer Ready
// Check, set the next action, and show the synced answers. No quote, no contact, no publish.
// Usage: bun scripts/link-mitti-920-janet.ts --inspect   (read-only look at the form)
//        bun scripts/link-mitti-920-janet.ts             (link + sync + next action)
import { linkMittiReadyCheckToJob } from "../src/lib/mitti-pickup.server";
import { parsePickupAudit } from "../src/lib/mitti-pickup.core";
import { mittiApi } from "../src/lib/mitti.core";
import { realMittiCall } from "../src/lib/mitti.server";
import { logEvent } from "../src/lib/workflow.server";
import { supabaseAdmin as admin } from "../src/integrations/supabase/client.server";

const JOB = "24e58ac0-63b6-43ec-87c2-35cbdeace1a0"; // HV-1538
const AUDIT = "920";
const ACTOR = "36b849de-1cde-425c-a05d-623f8985bbd6"; // Jo (admin) — approved action
const NEXT = "Waiting on Deep: finish form (price), owner mobile/email/permission";

const api = mittiApi(realMittiCall);
const audit = await api.getAudit(AUDIT);
const parsed = parsePickupAudit(audit);
console.log("FORM 920:", JSON.stringify({
  archived: audit?.archived ?? null,
  completed: audit?.audit_data?.date_completed ?? null,
  owner: parsed?.homeownerName, address: parsed?.siteAddress,
  template: parsed?.templateId, mittiRef: parsed?.mittiRef,
  author: parsed?.mittiOwnerUserId ?? null,
}, null, 2));

if (process.argv.includes("--inspect")) process.exit(0);

const r = await linkMittiReadyCheckToJob(ACTOR, { auditId: AUDIT, jobId: JOB });
console.log("LINK:", JSON.stringify(r));

await admin.from("jobs").update({ next_action: NEXT }).eq("id", JOB);
await logEvent(JOB, ACTOR, "mitti_ready_check_by_installer",
  "Ready Check done in Mitti by Reinsulate (Deep); form 920 linked, waiting on installer to finish the form",
  { audit_id: AUDIT, installer: "Reinsulate (Deep)", next_action: NEXT });

const { data: j } = await admin.from("jobs").select("stage,next_action,eligibility_outcome").eq("id", JOB).single();
console.log("JOB:", JSON.stringify(j));
const { data: m } = await admin.from("ceiling_measurements").select("*").eq("job_id", JOB).eq("is_current", true).maybeSingle();
console.log("MEASUREMENT:", JSON.stringify(m, null, 2));
process.exit(0);
