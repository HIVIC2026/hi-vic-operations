import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const retryFailedIneligibleEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), sendId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { retryFailedIneligible } = await import("./ineligible-retry.core");
    return retryFailedIneligible(data.jobId, {
      read: async () => {
        const { data: row, error } = await admin.from("customer_email_sends")
          .select("job_id, purpose, status, idempotency_key")
          .eq("id", data.sendId).eq("job_id", data.jobId).maybeSingle();
        if (error) throw new Error("Could not verify the failed send. Nothing retried.");
        return row;
      },
      send: async (jobId) => {
        const { sendPreliminaryIneligibleEmail } = await import("./followups.server");
        return sendPreliminaryIneligibleEmail(jobId, context.userId);
      },
    });
  });
