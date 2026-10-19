import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type OutboxRow = Database["public"]["Tables"]["external_action_outbox"]["Row"];

export type OutboxDispatchResult =
  | { ok: true; completedRef: string }
  | { ok: false; code: string; retryable: boolean };

export type OutboxDispatcher = (row: OutboxRow) => Promise<OutboxDispatchResult>;

export const AMBIGUOUS_EXTERNAL_CODES = new Set(["DELIVERY_UNKNOWN", "REMOTE_MAY_HAVE_SUCCEEDED"]);

const defaultDispatcher: OutboxDispatcher = async (row) => (await import("./external-action-dispatcher.server")).dispatchExternalAction(row);

export async function claimExternalActions(limit = 20, leaseSeconds = 300): Promise<OutboxRow[]> {
  const { data, error } = await admin.rpc("claim_external_actions" as never, { _limit: limit, _lease_seconds: leaseSeconds } as never);
  if (error) throw new Error(error.message);
  return (data ?? []) as OutboxRow[];
}

export async function finishExternalAction(row: OutboxRow, result: OutboxDispatchResult) {
  const retryable = result.ok ? false : result.retryable && !AMBIGUOUS_EXTERNAL_CODES.has(result.code);
  const { error } = await admin.rpc("finish_external_action" as never, {
    _id: row.id,
    _lease: row.lease_id,
    _ok: result.ok,
    _completed_ref: result.ok ? result.completedRef : null,
    _error_code: result.ok ? null : result.code,
    _retryable: retryable,
  } as never);
  if (error) throw new Error(error.message);
}

export async function processExternalActionOutbox(limit = 20, dispatcher: OutboxDispatcher = defaultDispatcher) {
  let rows: OutboxRow[];
  try { rows = await claimExternalActions(limit); }
  catch (e) {
    // Staged migration 0204 not applied: nothing can be claimed, so nothing is sent. Report it instead of a 500.
    const { isMissingDbObject } = await import("./schema-compat.core");
    if (isMissingDbObject({ message: (e as Error).message })) return { claimed: 0, completed: 0, failed: 0, retryScheduled: 0, unavailable: "external action executor not deployed (staged 0204)" };
    throw e;
  }
  let completed = 0, failed = 0, retryScheduled = 0, unrecorded = 0;
  for (const row of rows) {
    const result = await dispatcher(row).catch((e) => ({ ok: false as const, code: "REMOTE_MAY_HAVE_SUCCEEDED", retryable: false, detail: (e as Error).message }));
    // One row whose outcome cannot be recorded (e.g. lease lost) must not abandon the other claimed rows. That row stays
    // "processing" (never re-claimed, never re-sent) and is reported here for office reconciliation.
    try { await finishExternalAction(row, result); }
    catch (e) { unrecorded++; console.error("external action outcome not recorded", row.id, (e as Error).message); continue; }
    if (result.ok) completed++;
    else if (result.retryable && !AMBIGUOUS_EXTERNAL_CODES.has(result.code)) retryScheduled++;
    else failed++;
  }
  return { claimed: rows.length, completed, failed, retryScheduled, unrecorded };
}
