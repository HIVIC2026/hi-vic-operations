// P0-B: efficient, bounded read of enquiry response status for the Office dashboard.
// Server-side counts + a bounded "who still needs a response" queue. Does NOT touch getAdminPipeline.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { requireAdmin } from "@/lib/workflow.server";

export type EnquiryOverviewRow = {
  id: string; jobNumber: string | null; createdAt: string | null;
  ownerName: string | null; address: string | null; eligibilityOutcome: string | null;
  sent: boolean; failed: boolean; manualReview: boolean; hasEmail: boolean;
};
export type EnquiryResponseOverview = {
  counts: { total: number; sent: number; failed: number; awaiting: number; manualReview: number; noEmail: number };
  awaiting: EnquiryOverviewRow[];
};

/** Open homeowner enquiries with no confirmed send. Bounded to 2000 open jobs + the send history (small). */
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

  const [{ data: sends }, { data: comms }] = await Promise.all([
    admin.from("customer_email_sends").select("job_id, status"),
    admin.from("job_communications").select("job_id, direction, channel, delivery_status").eq("direction", "outbound").eq("channel", "email"),
  ]);
  const sentByJob = new Set<string>();
  const failedByJob = new Set<string>();
  for (const s of sends ?? []) {
    if (s.status === "sent" || s.status === "delivered_unrecorded") sentByJob.add(s.job_id);
    if (s.status === "failed") failedByJob.add(s.job_id);
  }
  for (const c of comms ?? []) {
    if (c.delivery_status === "sent" || c.delivery_status === "delivered") sentByJob.add(c.job_id);
    if (c.delivery_status === "failed") failedByJob.add(c.job_id);
  }

  const rows: EnquiryOverviewRow[] = (jobs ?? []).map((j) => {
    const owner = j.owners as { full_name?: string | null; email?: string | null } | null;
    const prop = j.properties as { address_line?: string | null; suburb?: string | null; postcode?: string | null } | null;
    const address = [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(", ") || null;
    return {
      id: j.id, jobNumber: j.job_number ?? null, createdAt: j.created_at ?? null,
      ownerName: owner?.full_name ?? null, address, eligibilityOutcome: j.eligibility_outcome ?? null,
      sent: sentByJob.has(j.id), failed: failedByJob.has(j.id),
      manualReview: j.eligibility_review_required === true, hasEmail: !!owner?.email,
    };
  });

  const counts = {
    total: rows.length,
    sent: rows.filter((r) => r.sent).length,
    failed: rows.filter((r) => r.failed && !r.sent).length,
    awaiting: rows.filter((r) => !r.sent && r.hasEmail).length,
    manualReview: rows.filter((r) => r.manualReview && !r.sent).length,
    noEmail: rows.filter((r) => !r.hasEmail).length,
  };
  const awaiting = rows.filter((r) => !r.sent && r.hasEmail).slice(0, 100);
  return { counts, awaiting };
});
