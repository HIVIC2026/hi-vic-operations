import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { z } from "zod";

/** Office signal: installer jobs whose owner quote is drafted and waiting, or held because something is missing. Read-only. */
export const getInstallerQuotesToCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ showTestJobs: z.boolean().optional() }).optional().parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { loadQuotesToCheck } = await import("./installer-quote-review.server");
    return loadQuotesToCheck(data ?? undefined);
  });

/** Jo 24 Oct: office reopens a quote the owner declined — it goes back to Quotes to check as a draft for Send. */
export const reopenDeclinedQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), quoteId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    const { reopenDeclinedQuoteImpl } = await import("./office-quote-review.server");
    return reopenDeclinedQuoteImpl(data.jobId, data.quoteId, context.userId);
  });
