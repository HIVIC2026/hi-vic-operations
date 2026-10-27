// Office email actions (decisions 245 + 247). Admin only. Never drafts or sends anything.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Needs me rows: open "Match this email" items and open "Owner asks to …" change requests. */
export const getOpenEmailItems = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./email-office.server")).openEmailItems();
  });

/** Match this email → file it on a job; `jobId: null` = "Not a customer" (left in Outlook, row cleared). */
export const matchOutlookEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ messageEventId: z.string().uuid(), jobId: z.string().uuid().nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./email-office.server")).matchOutlookEmail(data.messageEventId, data.jobId, context.userId);
  });

/** Apply a suggested change from an owner email through the existing guarded paths (never moves a booking). */
export const applyEmailChange = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid(), close: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./email-office.server")).applyEmailChange(data.eventId, context.userId, { close: data.close });
  });

/** Ignore a suggested change (nothing on the job changes; the row clears). */
export const ignoreEmailChange = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./email-office.server")).ignoreEmailChange(data.eventId, context.userId);
  });

/** Enquiries "Emails to match" (Jo 26 Oct 2026): unmatched emails with their best guess. */
export const getUnmatchedEmailRows = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./email-unmatched-rows.server")).unmatchedEmailRows();
  });
