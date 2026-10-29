// A48 batch 1 task 5: the office Ticks or Rejects an electrical certificate the AI couldn't tick (Needs me row). Office only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const tickCoes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./coes-check.server")).officeTickCoes(data.eventId, context.userId);
  });

export const rejectCoes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid(), note: z.string().max(500).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./coes-check.server")).officeRejectCoes(data.eventId, data.note, context.userId);
  });
