// Decision 307: the owner's 30-day-rule acknowledgement before choosing PIESA times — one read + one append-only write.
// No senders. Rules and wording: thirty-day-ack.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { hashToken } from "./worker-links.core";
import { INSTALL_WINDOW_EXPIRED_EVENT } from "./thirty-day-rule.core";
import {
  OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_SUMMARY, THIRTY_DAY_ACK_VERSION, THIRTY_DAY_ACK_WORDING, buildThirtyDayAck, piesaCycle, thirtyDayAckBlocker, thirtyDayAckNeeded,
} from "./thirty-day-ack.core";

/** Whether the owner still has to tick the 30-day box for the current PIESA cycle. */
export async function ownerThirtyDayAckState(jobId: string): Promise<{ needed: boolean; cycle: number; version: string; wording: string }> {
  const [{ count: expired, error: e1 }, { data: acks, error: e2 }] = await Promise.all([
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", INSTALL_WINDOW_EXPIRED_EVENT),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", OWNER_THIRTY_DAY_ACK_EVENT),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  const cycle = piesaCycle(expired ?? 0);
  const needed = thirtyDayAckNeeded({ cycle, acks: (acks ?? []).map((a) => (a.details ?? {}) as { cycle?: unknown }) });
  return { needed, cycle, version: THIRTY_DAY_ACK_VERSION, wording: THIRTY_DAY_ACK_WORDING };
}

/** Refuses unless the box is ticked (or already recorded this cycle); records the acknowledgement once per cycle. */
export async function requireOwnerThirtyDayAck(p: { jobId: string; userId: string | null; understandsThirtyDays: boolean | undefined; ip: string | null; userAgent: string | null }): Promise<{ recorded: boolean; cycle: number }> {
  const state = await ownerThirtyDayAckState(p.jobId);
  const blocker = thirtyDayAckBlocker({ needed: state.needed, understandsThirtyDays: p.understandsThirtyDays });
  if (blocker) throw new WorkflowError(blocker);
  if (!state.needed) return { recorded: false, cycle: state.cycle };
  const { data: q } = await admin.from("quotes").select("id").eq("job_id", p.jobId).eq("kind", "installation").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  const details = buildThirtyDayAck({
    cycle: state.cycle, quoteId: q?.id ?? null, at: new Date().toISOString(),
    ipHash: p.ip ? await hashToken(`thirty-day-ack-ip:${p.ip}`) : null, uaHash: p.userAgent ? await hashToken(`thirty-day-ack-ua:${p.userAgent}`) : null,
  });
  await logEvent(p.jobId, p.userId, OWNER_THIRTY_DAY_ACK_EVENT, THIRTY_DAY_ACK_SUMMARY, details as unknown as Record<string, unknown>);
  return { recorded: true, cycle: state.cycle };
}
