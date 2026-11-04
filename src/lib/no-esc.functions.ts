// Part 9 Task 14: office sets the per-job "no ESC" marker for a real run (Part 11's markRealRun calls setNoEscMarker
// directly; this is the office button's server function). Office only. One-way.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const setNoEscMarkerFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./no-esc.server")).setNoEscMarker(data.jobId, context.userId, data.reason);
  });
