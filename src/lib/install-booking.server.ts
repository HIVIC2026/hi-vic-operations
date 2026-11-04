// The CURRENT install booking of a job, read fresh (never a page's copy): the latest-scheduled installation booking that
// isn't cancelled. One helper for the Lead Installer lock (lead-installer-confirm.server, visit-allocation.server) and
// the safety plan readers (swms.server, swms-link.server), so every reader picks the same booking.
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows

export type CurrentInstallBooking = { id: string; scheduled_start: string; status: string; created_at: string | null };

/** Latest-scheduled non-cancelled installation booking, or null. A read error throws with the database's message. */
export async function currentInstallBooking(jobId: string): Promise<CurrentInstallBooking | null> {
  const { data, error } = await admin.from("bookings").select("id, scheduled_start, status, created_at").eq("job_id", jobId).eq("kind", "installation").neq("status", "cancelled")
    .order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const b = data as CurrentInstallBooking | null;
  return b?.scheduled_start ? b : null;
}

/** The current install booking only while it is confirmed (the Lead Installer lock reads this one). */
export async function currentConfirmedInstallBooking(jobId: string): Promise<CurrentInstallBooking | null> {
  const b = await currentInstallBooking(jobId);
  return b && b.status === "confirmed" ? b : null;
}

/** Part 9 Task 9: the booking the Lead Installer lock reads — the current CONFIRMED install booking, or null once the job's
 *  install is recorded complete (installation_completed_at set: nothing is locked after the install is done). A read error
 *  THROWS (every lock reader fails closed; never "not locked" on a failed read). */
export async function currentLockableInstallBooking(jobId: string): Promise<CurrentInstallBooking | null> {
  const [b, { data: job, error }] = await Promise.all([
    currentConfirmedInstallBooking(jobId),
    admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!b) return null;
  return (job as { installation_completed_at?: string | null } | null)?.installation_completed_at ? null : b;
}
