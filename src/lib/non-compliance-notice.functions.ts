import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const sendNonComplianceNoticeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), what: z.string().trim().min(3).max(1000), fix: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { sendNonComplianceNotice } = await import("./non-compliance-notice.server");
    return sendNonComplianceNotice(data.jobId, context.userId, { what: data.what, fix: data.fix });
  });
