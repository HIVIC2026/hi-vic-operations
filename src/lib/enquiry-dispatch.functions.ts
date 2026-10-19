// P0: authorised, safeguarded actions for the enquiry-response dashboard.
// These are REAL server functions (not placeholders). The id set is always recomputed server-side — a browser
// can never supply a list of homes to email — and every send is delegated to the hardened sender
// `sendSaveMySpot`, which re-checks both switches, consent, opt-out, saved estimate/link, the no-size
// (area_source) gate, Group B gates and per-home idempotency. Nothing is bypassed here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DispatchResult = { jobId: string; jobNumber: string | null; outcome: string; detail: string };

/** One HOT_SEND batch (see hot-leads-send.server). Kept as a literal so the validator stays client-safe. */
const BATCH_LIMIT = 10;

/** Dispatch one authorised batch of genuinely unanswered enquiries through the hardened sender. */
export const dispatchEnquiryBacklog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ limit: z.number().int().min(1).max(BATCH_LIMIT).default(BATCH_LIMIT) })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ attempted: number; results: DispatchResult[] }> => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { dispatchableJobIds, ensureEstimateLinks, DISPATCH_BATCH } = await import("./enquiry-dispatch.server");
    const ids = await dispatchableJobIds(Math.min(data.limit, DISPATCH_BATCH));
    if (ids.length === 0) return { attempted: 0, results: [] };
    // (Re)issue the secure Step-3 link first — never sends, only prepares the link the sender requires.
    // Historical backlog links expired after 30 days and were never renewed, which made every send skip.
    await ensureEstimateLinks(ids, context.userId);
    const { sendSaveMySpot } = await import("./hot-leads-send.server");
    const results = await sendSaveMySpot(ids, context.userId);
    return {
      attempted: ids.length,
      results: results.map((r) => ({
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        outcome: r.outcome,
        detail: r.detail,
      })),
    };
  });

/** Retry a single FAILED initial send. The sender only re-sends a confirmed failure (atomic re-reserve);
 *  an already-sent / in-flight home is skipped, so this can never duplicate an email. */
export const retryFailedEnquirySend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ outcome: string; detail: string }> => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { isRetryable, ensureEstimateLinks } = await import("./enquiry-dispatch.server");
    // This endpoint must never work as a generic "email this home" button.
    const allowed = await isRetryable(data.jobId);
    if (!allowed.ok) return { outcome: "blocked", detail: allowed.reason };
    // Same as a fresh dispatch: renew the expired link before the sender reads it. No send happens here.
    await ensureEstimateLinks([data.jobId], context.userId);
    const [r] = await (
      await import("./hot-leads-send.server")
    ).sendSaveMySpot([data.jobId], context.userId);
    return { outcome: r?.outcome ?? "failed", detail: r?.detail ?? "No result returned." };
  });
