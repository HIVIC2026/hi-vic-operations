import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getHotLeads = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ list: z.enum(["likely", "warm", "test"]).default("likely") }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const [leads, send] = await Promise.all([(await import("./hot-leads.server")).loadHotLeads(data.list), import("./hot-leads-send.server")]);
    return { ...leads, realSendingOn: await send.realSendingOn(), batchSize: send.HOT_SEND_BATCH };
  });

export const sendHotLeadsBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./hot-leads-send.server")).sendSaveMySpot(data.jobIds, context.userId);
  });

export const editHotLeadEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), email: z.string().max(200), reason: z.string().max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./hot-leads-send.server")).updateHotLeadEmail(data.jobId, data.email, data.reason, context.userId);
  });
