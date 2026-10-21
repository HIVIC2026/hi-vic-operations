import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, WorkflowError, logEvent, transition, getStage } from "./workflow.server";

export const getApQueue = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { loadApQueue } = await import("./ap-queue.server");
    return loadApQueue();
  });

/** AP approves ONE job. Its own permanent record (who, when, note, flags shown). Never bulk, never automatic. */
export const approveApJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), note: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if ((await getStage(data.jobId)) !== "ap_review") throw new WorkflowError("This job is no longer waiting for Final check.");
    const { jobApFlags } = await import("./ap-queue.server");
    const { approvalNoteBlocker } = await import("./ap-flags.core");
    const flags = (await jobApFlags([data.jobId])).get(data.jobId) ?? [];
    const block = approvalNoteBlocker(flags, data.note);
    if (block) throw new WorkflowError(block);
    await transition(data.jobId, "ready_for_veec", context.userId, "AP approved – Ready for VEEC");
    await logEvent(data.jobId, context.userId, "ap_approved", flags.length ? `AP approved a flagged job: ${data.note!.trim()}` : `AP approved${data.note?.trim() ? `: ${data.note.trim()}` : ""}`, { note: data.note?.trim() || null, flags, approved_at: new Date().toISOString() }, { internal: true });
    return { ok: true };
  });
