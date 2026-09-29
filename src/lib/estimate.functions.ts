import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getAdminEstimate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { refreshIndicativeEstimate } = await import("./estimate.server");
    return JSON.parse(JSON.stringify(await refreshIndicativeEstimate(data.jobId)));
  });

export const getOwnerEstimate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    const { refreshIndicativeEstimate, customerView } = await import("./estimate.server");
    return JSON.parse(JSON.stringify(customerView(await refreshIndicativeEstimate(data.jobId))));
  });

/** Public, no-login: the token is the only credential. Generic null on any failure. */
export const getPublicEstimate = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { resolvePublicEstimate } = await import("./estimatelink.server");
    return JSON.parse(JSON.stringify(await resolvePublicEstimate(data.token)));
  });

export const getAdminEstimateLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { adminLinkStatus } = await import("./estimatelink.server");
    return JSON.parse(JSON.stringify(await adminLinkStatus(data.jobId)));
  });

export const getAdminEstimateLinkUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { adminLinkPath } = await import("./estimatelink.server");
    return { path: await adminLinkPath(data.jobId) };
  });
