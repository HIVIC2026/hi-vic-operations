// The still-to-finish list (recovery_work): add, finish, retry. Table lives in docs/pending-migrations/recovery-work.sql.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { nextAfterFailure, type RecoveryKind, type RecoveryStatus } from "./recovery-work.core";

export type RecoveryItem = {
  kind: RecoveryKind; work_key: string; job_id: string | null; payload: Record<string, unknown>;
  attempts: number; status: RecoveryStatus; last_error: string | null;
};
type Err = { code?: string; message?: string } | null;

const table = () => admin.from("recovery_work" as never) as any;
const CLAIM_NOT_DEPLOYED = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);
const missing = (e: Err) => e?.code === "PGRST205" || e?.code === "42P01";
const fail = (e: NonNullable<Err>): never => { throw new Error(e.message ?? e.code ?? "recovery_work error"); };

export async function addWork(
  kind: RecoveryKind, workKey: string, jobId: string | null, payload: Record<string, unknown>,
  opts?: { status?: RecoveryStatus; lastError?: string },
): Promise<"added" | "exists" | "unavailable"> {
  const row: Record<string, unknown> = { kind, work_key: workKey, job_id: jobId, payload };
  if (opts?.status) row["status"] = opts.status;
  if (opts?.lastError) row["last_error"] = opts.lastError;
  const { error } = (await table().insert(row)) as { error: Err };
  if (!error) return "added";
  if (error.code === "23505") return "exists";
  if (missing(error)) { console.error("recovery_work table unavailable:", error.message); return "unavailable"; }
  return fail(error);
}

export async function workStatus(kind: RecoveryKind, workKey: string): Promise<RecoveryStatus | null | "unavailable"> {
  const { data, error } = (await table().select("status").eq("kind", kind).eq("work_key", workKey).maybeSingle()) as { data: { status: RecoveryStatus } | null; error: Err };
  if (missing(error)) { console.error("recovery_work table unavailable:", error?.message); return "unavailable"; }
  if (error) return fail(error);
  return data?.status ?? null;
}

export async function markDone(kind: RecoveryKind, workKey: string, note?: string): Promise<void> {
  const patch: Record<string, unknown> = { status: "done", done_at: new Date().toISOString() };
  if (note) patch["last_error"] = note;
  const { error } = (await table().update(patch).eq("kind", kind).eq("work_key", workKey)) as { error: Err };
  if (error) fail(error);
}

export async function markFailed(kind: RecoveryKind, workKey: string, error: string, now: Date = new Date()): Promise<RecoveryStatus> {
  const { data, error: readErr } = (await table().select("attempts").eq("kind", kind).eq("work_key", workKey).maybeSingle()) as { data: { attempts: number } | null; error: Err };
  if (readErr) fail(readErr);
  const attempts = data?.attempts ?? 0;
  const next = nextAfterFailure(attempts, now);
  const patch: Record<string, unknown> = { attempts: attempts + 1, last_error: error, status: next.status };
  if (next.nextAttemptAt) patch["next_attempt_at"] = next.nextAttemptAt;
  const { error: upErr } = (await table().update(patch).eq("kind", kind).eq("work_key", workKey)) as { error: Err };
  if (upErr) fail(upErr);
  return next.status;
}

export async function runRecoveryWork(
  handlers: Record<RecoveryKind, (item: RecoveryItem) => Promise<void>>, now: Date = new Date(),
): Promise<{ done: number; failed: number; needsOffice: number }> {
  const out = { done: 0, failed: 0, needsOffice: 0 };
  const { data, error } = (await (admin as any).rpc("claim_recovery_work", { p_limit: 50, p_lease_seconds: 300 })) as { data: RecoveryItem[] | null; error: Err };
  if (error) {
    if (CLAIM_NOT_DEPLOYED.has(error.code ?? "")) { console.error("recovery_work claim unavailable:", error.message ?? error.code); return out; }
    return fail(error);
  }
  for (const item of data ?? []) {
    const handler = handlers[item.kind];
    let handlerError: string | null = null;
    try {
      if (!handler) throw new Error("no handler");
      await handler(item);
    } catch (e) {
      handlerError = e instanceof Error ? e.message : String(e);
    }
    try {
      if (handlerError === null) {
        await markDone(item.kind, item.work_key);
        out.done++;
      } else {
        const status = await markFailed(item.kind, item.work_key, handlerError, now);
        if (status === "needs_office") out.needsOffice++; else out.failed++;
      }
    } catch (e) {
      console.error("recovery_work bookkeeping failed:", item.kind, item.work_key, e);
      out.failed++;
    }
  }
  return out;
}
