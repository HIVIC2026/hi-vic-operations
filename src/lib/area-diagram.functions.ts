// Office: see the generated Table 4 area diagram on the job page and regenerate it from the recorded facts (decision 211).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAreaDiagrams = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./area-diagram.server")).latestAreaDiagrams(data.jobId);
  });

/** Redraws from the job's current facts; the same facts file nothing new (content hash). Never sends anything. */
export const regenerateAreaDiagram = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), kind: z.enum(["ready_check", "final"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const s = await import("./area-diagram.server");
    return data.kind === "final" ? s.fileFinalAreaDiagram(data.jobId, context.userId) : s.fileReadyCheckAreaDiagram(data.jobId, context.userId);
  });
