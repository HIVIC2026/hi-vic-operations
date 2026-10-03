import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

export const getVerifiedEligibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { eligibilityView } = await import("./verified-eligibility.server");
    return JSON.parse(JSON.stringify(await eligibilityView(data.jobId)));
  });

export const recordVerifiedEligibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid,
    outcome: z.enum(["pending", "eligible", "not_eligible", "needs_review"]),
    reason: z.string().max(2000).nullable(),
    note: z.string().max(2000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { recordVerification } = await import("./verified-eligibility.server");
    return recordVerification(context.supabase as never, data.jobId, data.outcome, data.reason, data.note);
  });
