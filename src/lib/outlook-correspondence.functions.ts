// Office actions for Outlook correspondence: sync status, review queue, assign/dismiss/close. Admin only. Never sends.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getOutlookCorrespondenceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { readOutlookSyncState, pendingOutlookWorkCount, outlookConfigured } = await import("./outlook-sync.server");
    const { uncheckedOutlookHealth } = await import("./outlook-connection.core");
    const [st, pending, { data: reviews, error }] = await Promise.all([
      readOutlookSyncState(), pendingOutlookWorkCount(),
      admin.from("correspondence_reviews").select("id, kind, reason, suggested_reason, direction, from_address, recipients, subject, body, message_at, candidate_job_ids, job_id, jobs(job_number, stage)")
        .eq("status", "open").order("created_at", { ascending: false }).limit(100),
    ]);
    if (error) throw new Error(`Review queue unavailable: ${error.message}`);
    const ids = [...new Set((reviews ?? []).flatMap((r) => r.candidate_job_ids ?? []))];
    const { data: cands, error: ce } = ids.length ? await admin.from("jobs").select("id, job_number").in("id", ids)
      : { data: [] as { id: string; job_number: string }[], error: null };
    if (ce) throw new Error(`Candidate jobs unavailable: ${ce.message}`);
    const num = new Map((cands ?? []).map((c) => [c.id, c.job_number]));
    return {
      connection: uncheckedOutlookHealth(outlookConfigured(), st.expected_mailbox ?? null), pending,
      // Provider continuation tokens are server-only and never returned to this screen.
      state: { backfill_from: st.backfill_from, mailbox: st.mailbox, expected_mailbox: st.expected_mailbox,
        last_run_at: st.last_run_at, last_ok_at: st.last_ok_at, last_error: st.last_error, last_counts: st.last_counts,
        catchup_from: st.catchup_from, catchup_inbound_cursor: st.catchup_inbound_cursor, catchup_outbound_cursor: st.catchup_outbound_cursor,
        has_catchup_inbound_continuation: !!st.catchup_inbound_next_link, has_catchup_outbound_continuation: !!st.catchup_outbound_next_link },
      reviews: (reviews ?? []).map((r) => ({
        id: r.id, kind: r.kind as "unmatched" | "possible_not_proceeding" | "not_proceeding_progressed", reason: r.reason, suggestedReason: r.suggested_reason,
        direction: r.direction, from: r.from_address, recipients: (r.recipients as string[]) ?? [], subject: r.subject, body: r.body.slice(0, 2000), at: r.message_at,
        jobId: r.job_id, jobNumber: (r.jobs as { job_number: string } | null)?.job_number ?? null, jobStage: (r.jobs as { stage: string } | null)?.stage ?? null,
        candidates: (r.candidate_job_ids ?? []).map((id: string) => ({ id, jobNumber: num.get(id) ?? id.slice(0, 8) })),
      })),
    };
  });

export const checkOutlookConnectionHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mailbox: z.string().trim().email().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { checkOutlookConnection } = await import("./outlook-sync.server");
    return checkOutlookConnection(data.mailbox);
  });

export const confirmOutlookSyncMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mailbox: z.string().trim().email() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { confirmOutlookMailbox } = await import("./outlook-sync.server");
    await confirmOutlookMailbox(data.mailbox, context.userId);
    return { ok: true };
  });

export const resolveCorrespondenceReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    reviewId: z.string().uuid(),
    action: z.enum(["assign", "dismiss", "close_job"]),
    jobNumber: z.string().trim().max(20).optional(),
    reason: z.string().trim().max(300).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent, WorkflowError } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    // Assign may run more than once: Office can later confirm the same email belongs to a second job.
    // Each assignment is idempotent per job (per-job uniqueness) and audited; dismiss/close still
    // require an open review.
    const { data: r } = await admin.from("correspondence_reviews").select("*").eq("id", data.reviewId).maybeSingle();
    if (!r) throw new WorkflowError("This review item is already resolved.");
    if (data.action !== "assign" && r.status !== "open") throw new WorkflowError("This review item is already resolved.");
    const done = (status: string, extra: Record<string, unknown> = {}) => admin.from("correspondence_reviews")
      .update({ status, resolved_by: context.userId, resolved_at: new Date().toISOString(), ...extra }).eq("id", r.id).eq("status", "open");
    if (data.action === "dismiss") { await done("dismissed", { resolution_note: data.reason ?? null }); return { ok: true }; }
    if (data.action === "assign") {
      if (r.kind !== "unmatched") throw new WorkflowError("Only unmatched emails can be assigned.");
      const { data: job } = await admin.from("jobs").select("id, owners(email)").eq("job_number", (data.jobNumber ?? "").toUpperCase()).is("deleted_at", null).maybeSingle();
      if (!job) throw new WorkflowError("No job with that number.");
      const { storeOnJob } = await import("./outlook-sync.server");
      // Owner-linked mail stays customer-visible on that job; anything else is staff-visible so another
      // owner's mail or files are never exposed through a different job's customer view.
      const ownerEmail = ((job as { owners?: { email?: string | null } | null }).owners?.email ?? "").toLowerCase();
      const visibility = ownerEmail && (r.from_address ?? "").toLowerCase() === ownerEmail ? "customer" : "internal";
      const commId = await storeOnJob(job.id, {
        providerMessageId: r.provider_message_id, threadId: r.provider_thread_id, internetMessageId: null, direction: r.direction as "inbound" | "outbound",
        from: r.from_address, fromName: null, to: (r.recipients as string[]) ?? [], cc: [], subject: r.subject, body: r.body, at: r.message_at ?? r.created_at,
        hasAttachments: false, attachments: (r.attachment_refs as never) ?? [],
      }, "office_assigned", visibility);
      await done("assigned", { job_id: job.id, communication_id: commId ?? r.communication_id });
      await logEvent(job.id, context.userId, "correspondence_assigned", `Outlook email assigned to this job by Office`, { review_id: r.id, already_linked: commId === null });
      return { ok: true };
    }
    // close_job: an Office decision, so it may close any open stage; reason required and audited.
    if (!r.job_id) throw new WorkflowError("Assign the email to a job first.");
    const reason = (data.reason || r.suggested_reason || "").trim();
    if (reason.length < 3) throw new WorkflowError("A reason is required.");
    const { applyHoldOrCancel } = await import("./job-disposition.server");
    await applyHoldOrCancel(r.job_id, "cancel", reason, context.userId, { source: "outlook_review", review_id: r.id });
    await done("closed_job", { resolution_note: reason });
    return { ok: true };
  });

export const runOutlookSyncNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { runOutlookSync } = await import("./outlook-sync.server");
    const r = await runOutlookSync({ maxPages: 4 });
    return { ok: r.ok, blocker: r.blocker ?? null, counts: r.counts };
  });

/** Office sets (or stops) the historical catch-up start. Record-only; never starts a run by itself. */
export const setOutlookCatchup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ from: z.string().datetime().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { setCatchupFrom } = await import("./outlook-sync.server");
    await setCatchupFrom(data.from);
    return { ok: true };
  });
