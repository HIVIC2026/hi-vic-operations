// Called only after a verified inbound STOP has been persisted. No delivery/provider calls.
import { toAuE164 } from "./sms.core";

export const SMS_STOP_CLOSED_REASON = "Opted out (replied STOP)";

/** Use the existing Office classifier: saved/progressed/removed/deleted jobs are not open enquiries. */
export async function closeStoppedEnquiries(db: any, phone: string, sid: string | null, now: string) {
  const matches: Array<{ id: string; stage: string; owner_phone: string }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("office_enquiry_index")
      .select("id,stage,owner_phone").eq("office_bucket", "enquiry")
      .neq("source", "qa_test").is("deleted_at", null).order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("Could not read open enquiries for STOP closure");
    for (const row of data ?? []) if (toAuE164(row.owner_phone) === phone) matches.push(row);
    if ((data ?? []).length < 500) break;
  }
  for (const row of matches) {
    // Re-read the shared classifier before the conditional update; never overwrite a changed stage.
    const { data: current, error: readError } = await db.from("office_enquiry_index")
      .select("id,stage,owner_phone").eq("id", row.id).eq("office_bucket", "enquiry").maybeSingle();
    if (readError) throw new Error("Could not recheck enquiry for STOP closure");
    if (!current || current.stage !== row.stage || toAuE164(current.owner_phone) !== phone) continue;
    const { data: changed, error } = await db.from("jobs").update({
      stage: "cancelled", prior_stage: row.stage, cancelled_reason: SMS_STOP_CLOSED_REASON,
      hold_reason: null, last_activity_at: now,
    }).eq("id", row.id).eq("stage", row.stage).neq("source", "qa_test")
      .is("deleted_at", null).select("id").maybeSingle();
    if (error) throw new Error("Could not close enquiry after STOP");
    if (!changed) continue;
    const { error: auditError } = await db.from("workflow_events").insert({
      job_id: row.id, actor_id: null, event_type: "stage_changed",
      summary: `Cancelled: ${SMS_STOP_CLOSED_REASON}`, from_stage: row.stage, to_stage: "cancelled",
      internal: true, details: { source: "sms_stop", provider_message_id: sid },
    });
    if (auditError) throw new Error("STOP closure saved but audit could not be recorded");
  }
}