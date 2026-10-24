import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { THREE_QUESTIONS_CONFIRMATION } from "./three-questions-reminder.core";

/** Decision 172: the office one-off "3 questions" reminder (dry run, batched send, or one TEST job through test-send). */
export const threeQuestionsReminderBlast = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ dryRun: z.boolean().default(true), confirmation: z.literal(THREE_QUESTIONS_CONFIRMATION).optional(), testJobNumber: z.string().regex(/^HV-\d+$/).optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    if (!data.dryRun && !data.testJobNumber && data.confirmation !== THREE_QUESTIONS_CONFIRMATION) throw new Error("Explicit send confirmation required");
    const { runThreeQuestionsReminder } = await import("./three-questions-reminder.server");
    return runThreeQuestionsReminder(data.dryRun, context.userId, data.testJobNumber);
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
