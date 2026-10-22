// Office-only Mitti pickup functions (Jo 22 Oct 2026). Read-only scan plus one guarded link action.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { realMittiCall } from "./mitti.server";
import { scanMittiReadyCheckPickups, linkMittiReadyCheckToJob, listMittiSyncProblems, retryMittiSync } from "./mitti-pickup.server";

export const getMittiPickups = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return await scanMittiReadyCheckPickups(context.userId ?? null, realMittiCall);
  });

export const linkMittiPickup = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    const v = d as { auditId?: unknown; jobId?: unknown };
    if (typeof v?.auditId !== "string" || typeof v?.jobId !== "string") throw new Error("Choose the Mitti form and the job.");
    return { auditId: v.auditId, jobId: v.jobId };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return await linkMittiReadyCheckToJob(context.userId ?? null, data, realMittiCall);
  });

export const getMittiSyncProblems = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return await listMittiSyncProblems();
  });

export const retryMittiSyncFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => {
    const v = d as { jobId?: unknown };
    if (typeof v?.jobId !== "string") throw new Error("Choose the job to retry.");
    return { jobId: v.jobId };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return await retryMittiSync(context.userId ?? null, data, realMittiCall);
  });
