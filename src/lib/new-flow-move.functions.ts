import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ businessId: z.string().uuid() });

/** Office only: what (if anything) stops this installer moving onto the new flow. Writes nothing. */
export const previewNewFlowMoveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./new-flow-move.server")).previewNewFlowMove(data.businessId);
  });

/** Office only: move this installer onto the new flow, or say why not. */
export const moveInstallerToNewFlowFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => (await import("./new-flow-move.server")).moveInstallerToNewFlow(data.businessId, context.userId));
