import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** STEP 56: Office records what the email service shows for a Save my spot email whose outcome was unknown. Never sends. */
export const resolveSaveSpotOutcomeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), sendId: z.string().uuid(), attemptAt: z.string().max(64).nullable(), resolution: z.enum(["delivered", "not_delivered"]), note: z.string().max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { resolveUncertainSaveSpot } = await import("./save-spot-delivery.server");
    return resolveUncertainSaveSpot(data.jobId, context.userId, { sendId: data.sendId, attemptAt: data.attemptAt, resolution: data.resolution, note: data.note });
  });
