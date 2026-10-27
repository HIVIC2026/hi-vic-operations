import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { requireOfficeJob } from "./qa-office-access.server";

export const getApQueue = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { loadApQueue } = await import("./ap-queue.server");
    return loadApQueue();
  });

/** Decision 372: the one-screen Final check for ONE job (every check, tick/cross, why, evidence link). Read-only. */
export const getFinalCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOfficeJob(context.supabase, data.jobId);
    const { finalCheckScreen } = await import("./final-check.server");
    return finalCheckScreen(data.jobId, context.userId);
  });

/** AP approves ONE job. Its own permanent record (who, when, note, flags shown). Never bulk, never automatic.
 *  Decision 372: refused unless every Final check item passes (the same list the screen shows); transition re-runs every guard. */
export const approveApJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), note: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOfficeJob(context.supabase, data.jobId);
    return (await import("./ap-approve.server")).approveApJobAs(data.jobId, context.userId, data.note);
  });
