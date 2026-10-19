// P0-B: efficient, bounded read of enquiry response status for the Office dashboard.
// Server-side counts + a bounded "who still needs a response" queue. Does NOT touch getAdminPipeline.
// Scope (Jo): only enquiries WITHOUT a successful initial response are actionable; answered customers are
// never re-sent. Suppressed (opted-out) enquiries are excluded from the actionable queue.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { requireAdmin } from "@/lib/workflow.server";

export type EnquiryOverviewRow = {
  id: string; jobNumber: string | null; createdAt: string | null;
  ownerName: string | null; address: string | null; eligibilityOutcome: string | null;
  sent: boolean; failed: boolean; inFlight: boolean; manualReview: boolean; hasEmail: boolean; suppressed: boolean;
};
export type EnquiryResponseOverview = {
  counts: { total: number; sent: number; failed: number; awaiting: number; inFlight: number; manualReview: number; noEmail: number; suppressed: number };
  awaiting: EnquiryOverviewRow[];
};

/** Open homeowner enquiries with no confirmed send. Bounded to 2000 open jobs + the (small) send/comm histories. */
export const getEnquiryResponseOverview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }): Promise<EnquiryResponseOverview> => {
  await requireAdmin(context.supabase);
  const { data: jobs, error } = await admin
    .from("jobs")
    .select("id, job_number, created_at, stage, eligibility_outcome, eligibility_review_required, owners(full_name, email), properties(address_line, suburb, postcode)")
    .is("deleted_at", null)
    .neq("source", "qa_test")
    .not("stage", "in", "(complete,cancelled,on_hold)")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Enquiry overview could not be loaded: ${error.message}`);

  const [{ data: sends }, { data: comms }, { data: optouts }, { data: lcr }] = await Promise.all([
    admin.from("customer_email_sends").select("job_id, status"),
    admin.from("job_communications").select("job_id, direction, channel, delivery_status").eq("direction", "outbound").eq("channel", "email"),
    admin.from("customer_email_optouts").select("job_id, opted_out_at"),
    admin.from("lead_campaign_responses").select("job_id, opted_out_at"),
  ]);
  const sentByJob = new Set<string>();
  const failedByJob = new Set<string>();
  const inFlightByJob = new Set<string>();
  for (const s of sends ?? []) {
    if (s.status === "sent" || s.status === "delivered_unrecorded") sentByJob.add(s.job_id);
    if (s.status === "failed") failedByJob.add(s.job_id);
    if (s.status === "sending" || s.status === "queued") inFlightByJob.add(s.job_id);
  }
  for (const c of comms ?? []) {
    if (c.delivery_status === "sent" || c.delivery_status === "delivered") sentByJob.add(c.job_id);
    if (c.delivery_status === "failed") failedByJob.add(c.job_id);
    if (c.delivery_status === "queued") inFlightByJob.add(c.job_id);
  }
  const suppressedSet = new Set<string>();
  for (const o of optouts ?? []) if (o.opted_out_at) suppressedSet.add(o.job_id);
  for (const r of lcr ?? []) if (r.opted_out_at) suppressedSet.add(r.job_id);

  const rows: EnquiryOverviewRow[] = (jobs ?? []).map((j) => {
    const owner = j.owners as { full_name?: string | null; email?: string | null } | null;
    const prop = j.properties as { address_line?: string | null; suburb?: string | null; postcode?: string | null } | null;
    const address = [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(", ") || null;
    return {
      id: j.id, jobNumber: j.job_number ?? null, createdAt: j.created_at ?? null,
      ownerName: owner?.full_name ?? null, address, eligibilityOutcome: j.eligibility_outcome ?? null,
      sent: sentByJob.has(j.id), failed: failedByJob.has(j.id), inFlight: inFlightByJob.has(j.id),
      manualReview: j.eligibility_review_required === true,
      hasEmail: !!owner?.email, suppressed: suppressedSet.has(j.id),
    };
  });

  // Actionable = open, has email, NOT already answered, NOT suppressed. In-flight shown separately (never re-sent).
  const actionable = rows.filter((r) => !r.sent && r.hasEmail && !r.suppressed && !r.inFlight);
  const counts = {
    total: rows.length,
    sent: rows.filter((r) => r.sent).length,
    failed: rows.filter((r) => r.failed && !r.sent).length,
    awaiting: actionable.length,
    inFlight: rows.filter((r) => r.inFlight && !r.sent).length,
    manualReview: actionable.filter((r) => r.manualReview).length,
    noEmail: rows.filter((r) => !r.hasEmail).length,
    suppressed: rows.filter((r) => r.suppressed && !r.sent).length,
  };
  return { counts, awaiting: actionable.slice(0, 100) };
});
