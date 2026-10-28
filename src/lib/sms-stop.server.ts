// Called only after a verified inbound STOP has been persisted. No delivery/provider calls.
import { toAuE164 } from "./sms.core";

export const SMS_STOP_CLOSED_REASON = "Opted out (replied STOP)";

/** Use the existing Office classifier: saved/progressed/removed/deleted jobs are not open enquiries. */
/** Audit 23 Oct: a saved spot still waiting for its Ready Check booking also closes on STOP. */
export const STOP_SAVED_SPOT_STAGE = "ready_check_ready_to_schedule";

export async function closeStoppedEnquiries(db: any, phone: string, sid: string | null, now: string) {
  const matches: Array<{ id: string; stage: string; owner_phone: string; bucket: string }> = [];
  for (const [bucket, stage] of [["enquiry", null], ["active", STOP_SAVED_SPOT_STAGE]] as const) {
    for (let offset = 0; ; offset += 500) {
      let q = db.from("office_enquiry_index").select("id,stage,owner_phone").eq("office_bucket", bucket);
      if (stage) q = q.eq("stage", stage);
      const { data, error } = await q.neq("source", "qa_test").is("deleted_at", null).order("id").range(offset, offset + 499);
      if (error) throw new Error("Could not read open enquiries for STOP closure");
      const hits = (data ?? []).filter((row: { owner_phone: string }) => toAuE164(row.owner_phone) === phone);
      if (bucket === "active" && hits.length) {
        // Only saved spots — never other active (progressed) work.
        const { data: saved, error: savedError } = await db.from("lead_campaign_responses").select("job_id").in("job_id", hits.map((h: { id: string }) => h.id)).not("spot_saved_at", "is", null);
        if (savedError) throw new Error("Could not read saved spots for STOP closure");
        const ids = new Set((saved ?? []).map((x: { job_id: string }) => x.job_id));
        for (const row of hits) if (ids.has(row.id)) matches.push({ ...row, bucket });
      } else for (const row of hits) matches.push({ ...row, bucket });
      if ((data ?? []).length < 500) break;
    }
  }
  for (const row of matches) {
    // Re-read the shared classifier before the conditional update; never overwrite a changed stage.
    const { data: current, error: readError } = await db.from("office_enquiry_index")
      .select("id,stage,owner_phone").eq("id", row.id).eq("office_bucket", row.bucket).maybeSingle();
    if (readError) throw new Error("Could not recheck enquiry for STOP closure");
    if (!current || current.stage !== row.stage || toAuE164(current.owner_phone) !== phone) continue;
    // An installer already accepted (active assignment) or is still being asked (pending offer): release them and tell
    // the installer through the one full-cancel path, which logs its own stage change (no second history row here).
    const [{ data: assigned, error: assignedError }, { data: offered, error: offeredError }] = await Promise.all([
      db.from("job_assignments").select("id").eq("job_id", row.id).eq("active", true).limit(1),
      db.from("partner_offers").select("id").eq("job_id", row.id).eq("status", "pending").limit(1),
    ]);
    if (assignedError || offeredError) throw new Error("Could not check installer for STOP closure");
    if ((assigned ?? []).length || (offered ?? []).length) {
      const { cancelJobFully } = await import("./office-actions.server");
      await cancelJobFully(row.id, SMS_STOP_CLOSED_REASON, null, { tell: { owner: false, installer: true } });
      continue;
    }
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