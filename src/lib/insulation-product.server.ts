// Job-owned compliance record of the insulation product from the Mitti form (declared, not verified).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { insulationProduct, resolveMittiProduct, type InsulationProduct, type MittiProductResolution } from "./insulation-product.core";
import { contactAnswersFromEntries } from "./mitti.core";
import { logEvent } from "./workflow.server";

/** Product for an owner rate-card quote on our leads: the latest complete product recorded from the form. */
export async function productForHivQuote(jobId: string): Promise<{ product: InsulationProduct | null; source: "mitti_form" | null }> {
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = ev?.details as { ready?: boolean; product?: unknown } | null;
  const product = d?.ready ? insulationProduct(d.product) : null;
  return { product, source: product ? "mitti_form" : null };
}

/** Records only real changes. Missing/unknown answer → not ready (quote held). */
export async function mittiProductForJob(jobId: string, actorId: string | null, entries: { label: string; value: string | null }[], auditId: string): Promise<MittiProductResolution> {
  const a = contactAnswersFromEntries(entries);
  const resolved = resolveMittiProduct(a.productOption);
  const details = { audit_id: auditId, ...resolved, declared_not_verified: true };
  const { data: prev, error: pe } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pe) throw new Error("Could not check the job's product history.");
  if (JSON.stringify(prev?.details ?? null) !== JSON.stringify(details))
    await logEvent(jobId, actorId, "mitti_product_recorded", resolved.product ? `Insulation product recorded for compliance (declared, not verified): ${resolved.product.option}` : resolved.reasons.join(" · "), details, { internal: true });
  return resolved;
}
