// Reads the PERSISTED job source (never the caller's claim) before routing a TEST email to Jo's inbox, and records
// the original intended recipient (masked unless TEST-domain) in the audit.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { qaInboxRoute, type QaInboxRoute } from "./qa-inbox.core";
export async function qaDeliveryHeld(jobId: string | null): Promise<boolean> {
  if (!jobId) return false;
  const { data, error } = await admin.from("jobs").select("source,external_refs").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not verify TEST delivery safety.");
  return (await import("./qa-no-delivery.core")).qaNoDelivery(data?.source, data?.external_refs);
}

export async function qaInboxRouteForJob(jobId: string | null, to: string): Promise<QaInboxRoute | null> {
  if (!jobId) return null;
  const { data, error } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
  if (error || !data) return null; // unreadable = not proven TEST: the normal path (and its TEST boundary) applies
  return qaInboxRoute(data.source as string | null, to);
}

export async function auditQaInbox(jobId: string, route: QaInboxRoute, purpose: string, key: string | null) {
  await admin.from("admin_config_events").insert({ actor_id: null, event_type: "qa_inbox_redirect", summary: `TEST email for ${purpose} redirected to the TEST inbox`, details: { job_id: jobId, purpose, idempotency_key: key, original_recipient: route.original, delivered_to: route.to } as never });
}
