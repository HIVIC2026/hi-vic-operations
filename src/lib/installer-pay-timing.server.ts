// Review R09 / audit F19: the installer-payout eligibility facts for ONE job, read for the office Mark paid write
// (office.functions `markPayoutPaid`). The office Payouts tab (office-money.server `moneyPayouts`) reads the same three
// facts in batch and both apply the one pure rule `installerPayHeldReasons` (trade-view.core): AP approval recorded
// (the stage change to ready_for_veec) and, for installer-supplied (A1) jobs, the owner's payment in full (Xero mirror).
// Server-only, READ-ONLY. An unreadable fact throws, so Mark paid fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { installerPayHeldReasons, ownerPaidInFullAt } from "./trade-view.core";

/** Reasons an installer (installation) payout is not payable yet. Empty = payable on its normal timing. */
export async function installerPayHeldReasonsFor(jobId: string): Promise<string[]> {
  const [{ data: job, error: je }, { data: ap, error: ae }, { data: invs, error: ie }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec").order("created_at", { ascending: false }).limit(1),
    admin.from("invoices").select("status, balance_paid_at, paid_at, updated_at").eq("job_id", jobId),
  ]);
  if (je || ae || ie) throw new Error(`Could not read the installer pay timing: ${(je ?? ae ?? ie)!.message}`);
  if (!job) throw new Error("Job not found — payout not marked paid.");
  return installerPayHeldReasons({
    installerSupplied: job.channel === "installer_sourced",
    apApprovedAt: (ap ?? [])[0]?.created_at ?? null,
    ownerPaidInFullAt: ownerPaidInFullAt((invs ?? []) as { status: string | null; balance_paid_at: string | null; paid_at?: string | null; updated_at?: string | null }[]),
  });
}
