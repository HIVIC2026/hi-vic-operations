import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

export const getAdminJobEmailPreview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { jobEmailPreview } = await import("./job-email-preview.server");
    return jobEmailPreview(data.jobId);
  });

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
export const getPublicEstimate = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { resolvePublicEstimate } = await import("./estimatelink.server");
    return JSON.parse(JSON.stringify(await resolvePublicEstimate(data.token, context.assessmentTestMode)));
  });

const windowPicks = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).min(1).max(5);

/** Owner requests the free Ready Check and gives 3–5 times in one step (times are required for new requests). */
export const acceptReadyCheckFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), picks: windowPicks }).parse(d))
  .handler(async ({ data, context }) => {
    const { acceptReadyCheck } = await import("./readycheck-payment.server");
    return JSON.parse(JSON.stringify(await acceptReadyCheck(data.token, { ip: context.ip, userAgent: context.userAgent }, data.picks)));
  });

/** Owner (no-login link): Ready Check time picker state — times only. */
export const getReadyCheckWindowsFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { jobIdForToken } = await import("./readycheck-payment.server");
    const jobId = await jobIdForToken(data.token);
    if (!jobId) return null;
    const { ownerReadyCheckWindowState } = await import("./readycheck-booking.server");
    return ownerReadyCheckWindowState(jobId);
  });

/** Owner (no-login link): send more Ready Check times when asked. */
export const chooseReadyCheckWindowsFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), picks: windowPicks }).parse(d))
  .handler(async ({ data }) => {
    const { jobIdForToken } = await import("./readycheck-payment.server");
    const jobId = await jobIdForToken(data.token);
    if (!jobId) throw new Error("Estimate unavailable");
    const { submitReadyCheckWindows } = await import("./readycheck-booking.server");
    return submitReadyCheckWindows(jobId, data.picks);
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
