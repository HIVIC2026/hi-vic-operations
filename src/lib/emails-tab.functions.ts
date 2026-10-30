// Office Emails tab (decision 414). Admin only. Done / Ignore / Not a customer reuse email-office.functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getEmailsTab = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./emails-tab.server")).loadEmailsTab();
  });

/** Ask the AI for the drafts still missing (a few per call). Never sends. */
export const writeEmailDrafts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./emails-tab.server")).writeMissingEmailDrafts();
  });

export const sendJobEmailReply = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ requestEventId: z.string().uuid(), draftEventId: z.string().uuid(), body: z.string().min(1).max(8000), applyNote: z.boolean().optional(), applyArea: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./emails-tab.server")).sendJobEmailReply(data.requestEventId, data.draftEventId, data.body, context.userId, { applyNote: data.applyNote === true, applyArea: data.applyArea === true });
  });

export const sendNoJobEmailReply = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ unmatchedEventId: z.string().uuid(), draftEventId: z.string().uuid(), body: z.string().min(1).max(8000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./emails-tab.server")).sendNoJobEmailReply(data.unmatchedEventId, data.draftEventId, data.body, context.userId);
  });

export const matchEmailToJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ unmatchedEventId: z.string().uuid(), jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./emails-tab.server")).matchEmailToJob(data.unmatchedEventId, data.jobId, context.userId);
  });
