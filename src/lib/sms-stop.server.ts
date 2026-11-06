// Called only after a verified inbound STOP has been persisted. No delivery/provider calls.
import { toAuE164 } from "./sms.core";

export const SMS_STOP_CLOSED_REASON = "Opted out (replied STOP)";
/** Jo 7 Nov 2026: an email unsubscribe cancels the job the same way a STOP text does. */
export const EMAIL_UNSUBSCRIBE_CLOSED_REASON = "Opted out (unsubscribed)";
export type OptOutSource = "sms_stop" | "email_unsubscribe";
const CLOSED_REASON: Record<OptOutSource, string> = { sms_stop: SMS_STOP_CLOSED_REASON, email_unsubscribe: EMAIL_UNSUBSCRIBE_CLOSED_REASON };
const LABEL: Record<OptOutSource, string> = { sms_stop: "STOP", email_unsubscribe: "unsubscribe" };

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
  const failures: string[] = [];
  for (const row of matches) {
    const r = await closeOptedOutJob(db, row.id, "sms_stop", now, { sid, phone, expected: row });
    if (r.failure) failures.push(`${row.id}: ${r.failure}`);
  }
  if (failures.length) throw new Error(`STOP closure: releasing the installer failed for ${failures.length} job(s): ${failures.join("; ")}`);
}

type IndexRow = { id: string; stage: string; owner_phone: string; office_bucket: string };

/** The job's Office classifier row when it is an open enquiry or a saved spot still waiting for its Ready Check booking;
 *  null for anything else (progressed, removed, deleted or test work is never closed by an opt-out). */
async function closableRow(db: any, jobId: string, source: OptOutSource): Promise<IndexRow | null> {
  const { data: current, error } = await db.from("office_enquiry_index")
    .select("id,stage,owner_phone,office_bucket").eq("id", jobId).neq("source", "qa_test").is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`Could not recheck enquiry for ${LABEL[source]} closure`);
  if (!current) return null;
  if (current.office_bucket === "enquiry") return current;
  if (current.office_bucket !== "active" || current.stage !== STOP_SAVED_SPOT_STAGE) return null;
  const { data: saved, error: savedError } = await db.from("lead_campaign_responses").select("job_id")
    .eq("job_id", jobId).not("spot_saved_at", "is", null).limit(1);
  if (savedError) throw new Error(`Could not read saved spots for ${LABEL[source]} closure`);
  return (saved ?? []).length ? current : null;
}

/** One cancel rule for an owner opting out (STOP text or email unsubscribe): an open enquiry or saved spot is cancelled
 *  (through `cancelJobFully` when an installer holds or is being offered it); anything else is left alone. Never sends to
 *  the owner. `expected` (STOP): skip when the stage or phone changed since the scan. Returns the release failure, if any. */
export async function closeOptedOutJob(
  db: any, jobId: string, source: OptOutSource, now: string,
  o: { sid?: string | null; phone?: string; expected?: { stage: string; bucket: string } } = {},
): Promise<{ closed: boolean; failure?: string }> {
  const reason = CLOSED_REASON[source], label = LABEL[source];
  // Re-read the shared classifier before the conditional update; never overwrite a changed stage.
  const current = await closableRow(db, jobId, source);
  if (!current) return { closed: false };
  if (o.expected && (current.stage !== o.expected.stage || current.office_bucket !== o.expected.bucket)) return { closed: false };
  if (o.phone && toAuE164(current.owner_phone) !== o.phone) return { closed: false };
  const details = source === "sms_stop" ? { source, provider_message_id: o.sid ?? null } : { source };
  // An installer already accepted (active assignment) or is still being asked (pending offer): release them and tell
  // the installer through the one full-cancel path, which logs its own stage change (no second history row here).
  const [{ data: assigned, error: assignedError }, { data: offered, error: offeredError }] = await Promise.all([
    db.from("job_assignments").select("id").eq("job_id", jobId).eq("active", true).limit(1),
    db.from("partner_offers").select("id").eq("job_id", jobId).eq("status", "pending").limit(1),
  ]);
  if (assignedError || offeredError) throw new Error(`Could not check installer for ${label} closure`);
  if ((assigned ?? []).length || (offered ?? []).length) {
    // Same guards as the direct path: skip if the job changed, is a test job or was deleted since the first read.
    const { data: live, error: liveError } = await db.from("jobs").select("stage,source,deleted_at").eq("id", jobId).maybeSingle();
    if (liveError) throw new Error(`Could not recheck job for ${label} closure`);
    if (!live || live.stage !== current.stage || live.source === "qa_test" || live.deleted_at) return { closed: false };
    try {
      const { cancelJobFully } = await import("./office-actions.server");
      await cancelJobFully(jobId, reason, null, { tell: { owner: false, installer: true } });
      return { closed: true };
    } catch (e) {
      // No Needs me mechanism fits without new office-needs wiring: one internal history row the office sees on the job
      // (the existing STOP release retry + Needs me row pick it up by event type).
      await db.from("workflow_events").insert({
        job_id: jobId, actor_id: null, event_type: "stop_installer_release_failed", internal: true,
        summary: source === "sms_stop"
          ? "STOP received, but releasing the installer failed — retrying automatically; open the job if this stays"
          : "Unsubscribe received, but releasing the installer failed — retrying automatically; open the job if this stays",
        details: { ...details, needs_office: true },
      }).then(() => undefined, () => undefined);
      return { closed: true, failure: (e as Error).message };
    }
  }
  const { data: changed, error } = await db.from("jobs").update({
    stage: "cancelled", prior_stage: current.stage, cancelled_reason: reason,
    hold_reason: null, last_activity_at: now,
  }).eq("id", jobId).eq("stage", current.stage).neq("source", "qa_test")
    .is("deleted_at", null).select("id").maybeSingle();
  if (error) throw new Error(`Could not close enquiry after ${label}`);
  if (!changed) return { closed: false };
  const { error: auditError } = await db.from("workflow_events").insert({
    job_id: jobId, actor_id: null, event_type: "stage_changed",
    summary: `Cancelled: ${reason}`, from_stage: current.stage, to_stage: "cancelled",
    internal: true, details,
  });
  if (auditError) throw new Error(`${label === "STOP" ? "STOP" : "Unsubscribe"} closure saved but audit could not be recorded`);
  return { closed: true };
}
