import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";

export const COMPLIANCE_RECORD_KEYS = ["life_support_plan", "assignment_copy_to_consumer", "installer_safety_assessment", "pre_install_consumer_docs", "co_payment_paid", "completion_consumer_docs"] as const;
export type ComplianceRecordKey = (typeof COMPLIANCE_RECORD_KEYS)[number];

/** Office Activity 48 record (permanent). Caller must already be authorised as office. */
export async function recordComplianceRecord(p: { jobId: string; key: ComplianceRecordKey; occurredAt: string; reference: string | null; notes: string | null; actorId: string }) {
  const { error } = await admin.from("job_compliance_records").insert({ job_id: p.jobId, record_key: p.key, occurred_at: `${p.occurredAt}T00:00:00Z`, reference: p.reference, notes: p.notes, recorded_by: p.actorId });
  if (error) throw new Error(error.message);
  await logEvent(p.jobId, p.actorId, "compliance_record", `Recorded: ${p.key.replace(/_/g, " ")}`, { jobId: p.jobId, key: p.key, occurredAt: p.occurredAt, reference: p.reference, notes: p.notes }, { internal: true });
}

/** Signed PIESA copy handed to the owner or installer, against the current PIESA record. Caller must be office or the job's electrician. */
export async function recordPiesaCopyDelivery(p: { jobId: string; recipient: "owner" | "installer"; deliveredAt: string; method: "portal" | "email" | "in_person" | "post"; documentId?: string | null; notes?: string | null; actorId: string }) {
  if (new Date(p.deliveredAt).getTime() > Date.now() + 60_000) throw new WorkflowError("Delivery time cannot be in the future.");
  const { data: cur } = await admin.from("piesa_records").select("id").eq("job_id", p.jobId).eq("is_current", true).maybeSingle();
  if (!cur) throw new WorkflowError("No current PIESA record to deliver.");
  await admin.from("piesa_deliveries").insert({ job_id: p.jobId, piesa_record_id: cur.id, recipient: p.recipient, delivered_at: p.deliveredAt, method: p.method, document_id: p.documentId ?? null, notes: p.notes ?? null, recorded_by: p.actorId });
  await logEvent(p.jobId, p.actorId, "piesa_copy_delivered", `Signed PIESA copy delivered to ${p.recipient} (${p.method}) at ${p.deliveredAt}`, { piesa_record_id: cur.id });
}
