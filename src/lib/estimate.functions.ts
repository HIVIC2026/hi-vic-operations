import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

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

export const acceptPreAssessment = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!context.assessmentTestMode) throw new Error("Pre-assessment payments are not live.");
    const { acceptAssessment } = await import("./assessment-payment.server");
    return JSON.parse(JSON.stringify(await acceptAssessment(data.token, { ip: context.ip, userAgent: context.userAgent })));
  });

export const simulatePreAssessmentPayment = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), outcome: z.enum(["success", "failure"]), idempotencyKey: z.string().min(8).max(120) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!context.assessmentTestMode) throw new Error("Test payments are unavailable.");
    const { simulateAssessmentPayment } = await import("./assessment-payment.server");
    return JSON.parse(JSON.stringify(await simulateAssessmentPayment(data.token, data.outcome, data.idempotencyKey)));
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
