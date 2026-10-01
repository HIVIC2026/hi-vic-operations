import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAdminEngagement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { adminEngagement } = await import("./engagement.server");
    return JSON.parse(JSON.stringify(await adminEngagement(data.jobId)));
  });

export const suppressFollowupsAdmin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(300) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin, logEvent } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { suppressFollowups } = await import("./engagement.server");
    const n = await suppressFollowups(data.jobId, `admin: ${data.reason}`);
    await logEvent(data.jobId, context.userId, "followups_suppressed", `Estimate follow-ups suppressed by admin: ${data.reason}`, { count: n }, { internal: true });
    return { suppressed: n };
  });

/** Admin: attempt the initial Step 3 estimate email. Fails closed on every gate (comms OFF today). */
export const sendEstimateEmailAdmin = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { sendInitialEstimateEmail } = await import("./followups.server");
    return JSON.parse(JSON.stringify(await sendInitialEstimateEmail(data.jobId, context.userId)));
  });
