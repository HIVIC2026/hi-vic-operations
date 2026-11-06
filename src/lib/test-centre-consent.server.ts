// Test Centre only: persist the submitted tick, never infer consent or touch real intake.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { planContactConsent, sha256Hex, type Base44Snapshots } from "./enquiry.core";
import type { Json } from "@/integrations/supabase/types";

export async function recordTestCentreConsent(jobId: string, input: Base44Snapshots, db = admin) {
  const job = await db.from("jobs").select("owner_id,source").eq("id", jobId).maybeSingle();
  if (job.error || job.data?.source !== "qa_test" || !job.data.owner_id) throw new Error("TEST consent requires a TEST job.");
  const plan = planContactConsent(input);
  const existing = await db.from("owner_contact_consents").select("id").eq("job_id", jobId).eq("source", "qa_test").eq("consent_key", plan.consent_key).maybeSingle();
  if (existing.error) throw new Error("Could not check TEST consent.");
  if (existing.data) return { created: false, status: plan.consent_status };
  const { externalContactPermitted: _permission, ...row } = plan;
  const result = await db.from("owner_contact_consents").insert({ ...row, snapshot: row.snapshot as Json, job_id: jobId, owner_id: job.data.owner_id, source: "qa_test", sha256: await sha256Hex(JSON.stringify(row.snapshot)) });
  if (result.error && result.error.code !== "23505") throw new Error("Could not save TEST consent.");
  return { created: !result.error, status: plan.consent_status };
}