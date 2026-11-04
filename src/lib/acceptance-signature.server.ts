import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { ACCEPTANCE_COUNTERSIGNED_EVENT, DOCUMENTS_BY_EMAIL_CONSENT_EVENT, acceptanceSignatureRecord } from "./acceptance-signature.core";

type Row = { details: Record<string, unknown> | null };
async function find(jobId: string, type: string, quoteId: string, version: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", type);
  if (error) throw new Error(error.message);
  const hit = ((data ?? []) as Row[]).find((r) => r.details?.["quote_id"] === quoteId && r.details?.["version"] === version);
  return hit?.details ?? null;
}

/** Writes the counter-signature and the documents-by-email consent once per quote version (read-then-insert; no DB change). */
export async function recordAcceptanceSignature(jobId: string, actorId: string | null, i: { quoteId: string; version: number; typedName: string; signedAt: string }) {
  const r = acceptanceSignatureRecord(i);
  if (!(await find(jobId, ACCEPTANCE_COUNTERSIGNED_EVENT, i.quoteId, i.version)))
    await logEvent(jobId, actorId, ACCEPTANCE_COUNTERSIGNED_EVENT, "Quote accepted: signed by the owner and counter-signed by Chris Lowe", r.countersigned);
  if (!(await find(jobId, DOCUMENTS_BY_EMAIL_CONSENT_EVENT, i.quoteId, i.version)))
    await logEvent(jobId, actorId, DOCUMENTS_BY_EMAIL_CONSENT_EVENT, "Owner agreed to get documents by email", r.documentsConsent);
}

/** For the signed acceptance PDF: the recorded typed name and signing time, or null when not recorded. */
export async function readAcceptanceCountersignature(jobId: string, quoteId: string, version: number): Promise<{ ownerTypedName: string; signedAt: string } | null> {
  const d = await find(jobId, ACCEPTANCE_COUNTERSIGNED_EVENT, quoteId, version);
  return d && typeof d["owner_typed_name"] === "string" && typeof d["signed_at"] === "string" ? { ownerTypedName: d["owner_typed_name"], signedAt: d["signed_at"] } : null;
}
