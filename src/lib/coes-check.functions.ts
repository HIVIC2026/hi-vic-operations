// A48 batch 1 task 5: the office Ticks or Rejects an electrical certificate the AI couldn't tick, or asks for a fresh check
// (Needs me row). Office only. `eventId` is the row's certificate event (absent on a "not checked yet" row).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const tickCoes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), eventId: z.string().uuid().nullable().default(null) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./coes-check.server")).officeTickCoes(data.jobId, data.eventId, context.userId);
  });

export const rejectCoes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), eventId: z.string().uuid().nullable().default(null), note: z.string().max(500).default("") }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./coes-check.server")).officeRejectCoes(data.jobId, data.eventId, data.note, context.userId);
  });

export const recheckCoes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./coes-check.server")).officeRecheckCoes(data.jobId, context.userId);
  });
