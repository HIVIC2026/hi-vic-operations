import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// A1 manual customer communication (STEP 17). Office (admin) only. Nothing here sends email/SMS.

/** Renders the lead's approved email for Office to copy and send by hand. Writes no send record and, unless
 *  `issueLinks` (the explicit "Create sending links" step), creates no unsubscribe/referral token either. */
export const prepareManualEmailFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), issueLinks: z.boolean().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./manual-communication.server")).prepareManualEmail(data.jobId, context.userId ?? null, { issueLinks: data.issueLinks === true });
  });

/** Records the outcome of a communication Office handled outside the portal (record only). */
export const recordManualCommunicationFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    jobId: z.string().uuid(),
    outcome: z.enum(["sent_manually", "phoned", "not_sent", "followup_required"]),
    template: z.enum(["save_my_spot", "ineligible_result"]).optional(),
    subject: z.string().max(500).optional(),
    body: z.string().max(50000).optional(),
    note: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./manual-communication.server")).recordManualCommunication(data, context.userId ?? null);
  });

/** Communication history for one job, each entry labelled manual (Office) or sent by the portal. */
export const getManualCommunicationHistoryFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./manual-communication.server")).manualCommunicationHistory(data.jobId);
  });
