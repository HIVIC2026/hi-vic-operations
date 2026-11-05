// Photo-quote installers (Jo 5 Nov 2026): reads behind the pure photo-quote.core rules. No senders here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { PHOTO_QUOTE_GIVE_EVENT, photoGiveFrom, type GiveEventRow, type PhotoGive } from "./photo-quote.core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** The job's current "From photos" give, or null (Ready Check / not given / handed back). A failed read throws. */
export async function photoGiveFor(jobId: string, db: Db = admin as unknown as Db): Promise<PhotoGive | null> {
  const [events, assignments] = await Promise.all([
    db.from("workflow_events").select("event_type,created_at,details").eq("job_id", jobId).in("event_type", ["in_house_batch_sent", PHOTO_QUOTE_GIVE_EVENT]).order("created_at"),
    db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true),
  ]);
  if (events.error || assignments.error) throw new Error("Could not read how this job is quoted.");
  return photoGiveFrom((events.data ?? []) as GiveEventRow[], ((assignments.data ?? []) as { business_id: string }[]).map((a) => a.business_id));
}
