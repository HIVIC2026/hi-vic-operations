// Jo 7 Nov 2026: DON'T START is a hard lock on recording an install as done (pure rule: prestart.core installGoBlocker).
// Kept apart from prestart.server so the completion path does not pull in the GO check runner and its senders.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { GO_CHECK_NOT_COMPLETED, NOT_CLEARED_TO_START, installGoBlocker } from "./prestart.core";

/** The DON'T START refusal for this install start, or null when it had a GO. A read failure refuses (fails closed). */
export async function installGoBlockerFor(jobId: string, start: string | null | undefined): Promise<string | null> {
  const { data, error } = await admin.from("pre_start_checks").select("scheduled_start, passed, failures, checked_at").eq("job_id", jobId);
  if (error) return NOT_CLEARED_TO_START([GO_CHECK_NOT_COMPLETED(error.message)]);
  return installGoBlocker(start, ((data ?? []) as { scheduled_start: string; passed: boolean; failures: unknown; checked_at: string }[])
    .map((c) => ({ ...c, failures: Array.isArray(c.failures) ? (c.failures as string[]) : [] })));
}
