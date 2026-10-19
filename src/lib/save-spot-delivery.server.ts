// STEP 56: Office resolution of a Save my spot email whose outcome is unknown (customer_email_sends
// "delivered_unrecorded", or a "sending" reservation left behind by a stopped process). Office-only: the RPC enforces
// requireAdmin. This never calls the email service, never sends, never changes the comms switches or approval flags,
// and never touches manual communication records. It only records what the Office found in the email service:
//   delivered     -> "sent"   (final; the home is never sent this email again)
//   not delivered -> "failed" (a confirmed failure: the normal guarded sender may send it once more, or the Office can
//                              hand-send it through "Prepare email" and record "Sent manually")
// The Office resolves one specific attempt (send id + attempt time from the Leads list). The update is conditional on that
// attempt still being unresolved, so a second Office user, a newer attempt or a send in progress can't be overwritten.
// "Delivered" records sent_at as the attempt time (the exact delivery time is unknown).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import { RESOLUTION_LABEL, SEND_KIND_LABEL, resolutionBlocker, resolutionError, resolutionStatus, sendKindFromKey, type SaveSpotResolution } from "./save-spot-delivery.core";

type SendRow = { id: string; job_id: string; purpose: string; status: string; created_at: string | null; error: string | null; idempotency_key: string | null };

export type ResolveInput = { sendId: string; attemptAt: string | null; resolution: SaveSpotResolution; note: string };

/** Resolve exactly the attempt the Office checked (send id + attempt time as shown on the Leads list). */
export async function resolveUncertainSaveSpot(jobId: string, actorId: string | null, input: ResolveInput) {
  const { sendId, attemptAt, resolution, note } = input;
  const { data, error } = await admin.from("customer_email_sends").select("id, job_id, purpose, status, created_at, error, idempotency_key").eq("id", sendId).maybeSingle();
  if (error) throw new Error("Could not read the email record. Nothing changed; try again.");
  const found = data && data.job_id === jobId && data.purpose === LAUNCH_CAMPAIGN ? (data as SendRow) : null;
  const now = Date.now();
  const blocker = resolutionBlocker({ row: found && ["delivered_unrecorded", "sending"].includes(found.status) ? found : null, note, now, attemptAt });
  if (blocker || !found) throw new Error(blocker ?? "There is no unresolved Save my spot email for this lead.");
  const row = { ...found }; // the attempt the Office checked; the update below only applies if it is still exactly that
  const status = resolutionStatus(resolution);
  const patch = { status, error: resolutionError(resolution, note, row), ...(status === "sent" ? { sent_at: row.created_at } : {}) };
  const { data: changed, error: updateError } = await admin.from("customer_email_sends")
    .update(patch).eq("id", row.id).eq("status", row.status).eq("created_at", row.created_at!).select("id");
  if (updateError) throw new Error("Could not save the resolution. Nothing changed; try again.");
  if (!changed?.length) throw new Error("This email record changed while you were checking it. Reload and check again.");
  let auditLogged = true;
  try {
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, actorId, "save_my_spot_outcome_resolved", `${SEND_KIND_LABEL[sendKindFromKey(row.idempotency_key)]} outcome resolved by the office: ${RESOLUTION_LABEL[resolution]}. ${note.trim()}`.slice(0, 500),
      { resolution, previous_status: row.status, new_status: status, send_id: row.id, attempt_at: row.created_at, idempotency_key: row.idempotency_key, note: note.trim() }, { internal: true });
  } catch {
    auditLogged = false; // the row itself keeps the Office note (error column), so the decision is still traceable
  }
  return { ok: true as const, status, auditLogged };
}
