import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const getEnquiryGroups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).passthrough().parse(d ?? {}))
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { loadEnquiryGroups } = await import("./enquiry-groups.server");
    const r = await loadEnquiryGroups();
    return { rows: r.rows.map(({ consent, optedOut, bounced, source, isPrimaryForEmail, alreadySent, ...row }) => ({ ...row, contactFlags: { consent, optedOut, bounced, duplicate: row.kind === "job" && !isPrimaryForEmail } })), scope: r.scope };
  });

export const prepareEnquiryEmailsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    ids: z.array(z.string().uuid()).min(1).max(5000),
    group: z.enum(["likely_size", "likely_no_size", "insulation_check", "other"]),
    otherReason: z.enum(["needs_review", "missing_info", "not_eligible", "progressing", "closed"]).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { prepareEnquiryEmails } = await import("./enquiry-groups.server");
    return prepareEnquiryEmails(data.ids, { group: data.group, otherReason: data.otherReason });
  });
