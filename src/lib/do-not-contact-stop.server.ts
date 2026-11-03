// An owner replying STOP turns on "Do not contact" for every open job with that mobile (Jo 2 Nov). Only the office turns it off.
import { toAuE164 } from "./sms.core";
import { DO_NOT_CONTACT_SET_EVENT, DO_NOT_CONTACT_CLEARED_EVENT, doNotContactOn } from "./do-not-contact.core";

/** Returns how many jobs it turned on. Read failures throw (fail closed). */
export async function setDoNotContactFromStop(db: any, phone: string, sid: string | null, now: string): Promise<number> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await db.from("jobs").select("id, owners(phone)").is("deleted_at", null).neq("stage", "cancelled").order("id").range(offset, offset + 199);
    if (error) throw new Error("Could not read jobs for STOP Do not contact");
    for (const row of data ?? []) if (toAuE164(row.owners?.phone ?? "") === phone) ids.push(row.id);
    if ((data ?? []).length < 200) break;
  }
  let turnedOn = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await db.from("workflow_events").select("job_id, event_type, created_at").in("job_id", chunk).in("event_type", [DO_NOT_CONTACT_SET_EVENT, DO_NOT_CONTACT_CLEARED_EVENT]);
    if (error) throw new Error("Could not read Do not contact for STOP");
    const byJob = new Map<string, { event_type: string; created_at: string }[]>();
    for (const e of data ?? []) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);
    for (const id of chunk) {
      if (doNotContactOn(byJob.get(id) ?? [])) continue;
      const { error: insertError } = await db.from("workflow_events").insert({
        job_id: id, actor_id: null, event_type: DO_NOT_CONTACT_SET_EVENT, internal: true, created_at: now,
        summary: "Owner replied STOP: do not contact", details: { source: "sms_stop", provider_message_id: sid, note: "Owner replied STOP" },
      });
      if (insertError) throw new Error("Could not turn on Do not contact after STOP");
      turnedOn++;
    }
  }
  return turnedOn;
}
