// Review R09 / audit F19: the installer-payout eligibility facts for ONE job, read for the office Mark paid write
// (office.functions `markPayoutPaid`). The office Payouts tab (office-money.server `moneyPayouts`) reads the same three
// facts in batch and both apply the one pure rule `installerPayHeldReasons` (trade-view.core): AP approval recorded
// (the stage change to ready_for_veec) and, for installer-supplied (A1) jobs, the owner's payment in full (Xero mirror).
// Server-only, READ-ONLY. An unreadable fact throws, so Mark paid fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { installerPayHeldReasons, installerPayRuleLine, ownerPaidInFullAt, payState } from "./trade-view.core";

async function payFacts(jobId: string) {
  const [{ data: job, error: je }, { data: ap, error: ae }, { data: invs, error: ie }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "stage_changed").eq("to_stage", "ready_for_veec").order("created_at", { ascending: false }).limit(1),
    admin.from("invoices").select("kind, status, balance_paid_at, paid_at, updated_at").eq("job_id", jobId).eq("kind", "installation"),
  ]);
  if (je || ae || ie) throw new Error(`Could not read the installer pay timing: ${(je ?? ae ?? ie)!.message}`);
  if (!job) throw new Error("Job not found — payout not marked paid.");
  return {
    installerSupplied: job.channel === "installer_sourced",
    apApprovedAt: (ap ?? [])[0]?.created_at ?? null,
    ownerPaidInFullAt: ownerPaidInFullAt((invs ?? []) as { kind?: string | null; status: string | null; balance_paid_at: string | null; paid_at?: string | null; updated_at?: string | null }[]),
  };
}

/** Reasons an installer (installation) payout is not payable yet. Empty = payable on its normal timing. */
export async function installerPayHeldReasonsFor(jobId: string): Promise<string[]> {
  return installerPayHeldReasons(await payFacts(jobId));
}

/** Part 5b (Jo 1–5 Nov 2026): the installer job page / Money read — the same facts, plus the pay rule in Jo's words for this
 *  job's source (own customer: paid once the owner has paid in full; Home Insulation Victoria lead: 7 days after approval)
 *  and when the pay falls due (null while held). Read-only; `payState` (trade-view.core) is the one timing rule. */
export async function installerPayTimingFor(jobId: string): Promise<{ installerSupplied: boolean; held: string[]; ruleLine: string; dueAt: string | null }> {
  const f = await payFacts(jobId);
  const state = payState({ paidAt: null, ...f });
  return { installerSupplied: f.installerSupplied, held: installerPayHeldReasons(f), ruleLine: installerPayRuleLine(f.installerSupplied), dueAt: state.kind === "coming" ? state.on : null };
}
