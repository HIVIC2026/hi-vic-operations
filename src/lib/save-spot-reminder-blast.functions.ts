import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const saveSpotReminderBlast = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ dryRun: z.boolean().default(true), confirmation: z.literal("SEND SAVE SPOT REMINDER BLAST").optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    if (!data.dryRun && data.confirmation !== "SEND SAVE SPOT REMINDER BLAST") throw new Error("Explicit send confirmation required");
    const { runSaveSpotReminderBlast } = await import("./save-spot-reminder-blast.server");
    return runSaveSpotReminderBlast(data.dryRun);
  });

export const getSpotReminderSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { enabled, activatedAt } = await (await import("./save-spot-reminder-settings.server")).reminderSettings();
    return { enabled, activatedAt };
  });

export const setSpotReminderSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./save-spot-reminder-settings.server")).setReminderEnabled(data.enabled,context.userId);
  });