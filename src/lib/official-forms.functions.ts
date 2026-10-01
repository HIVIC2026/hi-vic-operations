import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Office panel: PIISA responsible role, due state, next action and blockers (read-only). */
export const getPiisaPanel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { piisaPanel } = await import("./official-forms.server");
    const { todayMelbourne } = await import("./eligibility.server");
    return piisaPanel(data.jobId, todayMelbourne());
  });

/** Office invalidates a stale signed copy (reason required, permanent). */
export const invalidateOfficialCopy = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { invalidateCopy } = await import("./official-forms.server");
    await invalidateCopy(data.id, data.reason, context.userId);
    return { ok: true };
  });

/** Server-issued 5-minute link; RLS on the caller's own client decides visibility. */
export const officialCopyLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { signedCopyUrl } = await import("./official-forms.server");
    return { url: await signedCopyUrl(context.supabase as never, data.id) };
  });
