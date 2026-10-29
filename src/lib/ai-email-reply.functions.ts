// AI email reply drafts on the job page (Jo 26 Oct 2026). Office only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAiReplyDrafts = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./ai-email-reply.server")).listAiDrafts(data.jobId);
  });

export const sendAiReplyDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid(), body: z.string().trim().min(2).max(8000), applyNote: z.boolean().optional(), applyArea: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./ai-email-reply.server")).sendAiDraft(data.eventId, data.body, context.userId, { applyNote: data.applyNote === true, applyArea: data.applyArea === true });
  });

export const discardAiReplyDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    await (await import("./ai-email-reply.server")).discardAiDraft(data.eventId, context.userId);
    return { ok: true };
  });

/** Save an edit to a draft as Jo types (Jo 27 Oct 2026). Never sends. */
export const saveAiReplyDraftEdit = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid(), body: z.string().max(8000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./ai-email-reply.server")).saveDraftEdit(data.eventId, data.body, context.userId);
  });
