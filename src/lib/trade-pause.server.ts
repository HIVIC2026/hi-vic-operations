// "Pause all trade messages" (Jo 30 Oct 2026): the one read of `workflow_settings.trade_messages_paused`, once per send.
// Rules in trade-pause.core.ts. Missing column (SQL not live) = NOT paused + a warning; any other read failure holds.
// Never sends; safe to import from sender modules only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { jobPauseLift, pauseLiftWanted, readTradePause, recipientPauseLift, type PauseLift } from "./trade-pause.core";

let missingWarned = false;

/** The hold reason while trade messages are paused, else null. */
export async function tradeMessagesPausedNow(opts?: { businessId?: string | null; jobId?: string | null }): Promise<string | null> {
  let r: { data: unknown; error: { code?: string | null; message?: string | null } | null };
  try {
    r = await (admin as any).from("workflow_settings").select("trade_messages_paused").eq("id", 1).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch (e) {
    r = { data: null, error: { message: (e as Error).message } };
  }
  const out = readTradePause({ data: r.data as { trade_messages_paused?: boolean | null } | null, error: r.error });
  // The missing-column warning is logged once per process (it would repeat on every send); real read failures every time.
  if (out.warning && (out.reason !== null || !missingWarned)) { if (out.reason === null) missingWarned = true; console.warn(out.warning); }
  if (!pauseLiftWanted(out.reason, opts)) return out.reason;
  // Per-business exception (Jo 31 Oct; narrowed 3 Nov; pure rules recipientPauseLift / jobPauseLift since Deep Part 1).
  // Any read failure keeps the hold.
  // - Recipient business known: lifted only if it is flagged, or it is an electrician actively linked to a flagged
  //   installer AND (no job given, or that installer is the job's originating installer or an active assignee).
  //   The job's other businesses never lift a message to a known, uncovered recipient.
  // - Only a job given: lifted if the job's originating installer or an active assignee is flagged.
  const answer = (lift: PauseLift) => (lift === "lift" ? null : out.reason);
  try {
    if (opts!.businessId) {
      const pr = await (admin as any).from("partner_relationships").select("installer_business_id").eq("electrician_business_id", opts!.businessId).eq("active", true); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (pr.error) return out.reason;
      const ids = new Set<string>([opts!.businessId]);
      for (const r of (pr.data ?? []) as { installer_business_id: string | null }[]) if (r.installer_business_id) ids.add(r.installer_business_id);
      const flagged = await flaggedAmong([...ids]);
      const first = recipientPauseLift({ recipientId: opts!.businessId, flagged, jobId: opts!.jobId ?? null });
      if (first !== "check_job") return answer(first);
      return answer(jobPauseLift(flagged, await jobBusinessIds(opts!.jobId!)));
    }
    const onJob = await jobBusinessIds(opts!.jobId!);
    if (!onJob || !onJob.size) return out.reason;
    return answer(jobPauseLift(await flaggedAmong([...onJob]), onJob));
  } catch { return out.reason; }
}

/** Ids among `ids` whose messages_while_paused is exactly true; null when the read failed. */
async function flaggedAmong(ids: string[]): Promise<Set<string> | null> {
  const b = await (admin as any).from("businesses").select("id, messages_while_paused").in("id", ids); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (b.error) return null;
  return new Set(((b.data ?? []) as { id: string; messages_while_paused?: boolean | null }[]).filter((x) => x.messages_while_paused === true).map((x) => x.id));
}

/** The job's originating installer + active assignees; null when a read failed. */
async function jobBusinessIds(jobId: string): Promise<Set<string> | null> {
  const ids = new Set<string>();
  const j = await (admin as any).from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (j.error) return null;
  const orig = (j.data as { originating_installer_business_id?: string | null } | null)?.originating_installer_business_id;
  if (orig) ids.add(orig);
  const ja = await (admin as any).from("job_assignments").select("business_id").eq("job_id", jobId).eq("active", true); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (ja.error) return null;
  for (const r of (ja.data ?? []) as { business_id: string | null }[]) if (r.business_id) ids.add(r.business_id);
  return ids;
}
