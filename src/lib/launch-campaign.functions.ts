import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

const token = z.string().max(200);

export const getLaunchCampaignPage = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data, context }) => (await import("./launch-campaign.server")).campaignPage(data.token, context.assessmentTestMode));

export const saveMySpot = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, calc: z.object({ areaM2: z.number().min(20).max(1000), insulation: z.enum(["none", "present", "unknown"]).nullable() }).nullish() }).parse(d))
  .handler(async ({ data }) => (await import("./launch-campaign.server")).saveCampaignSpot(data.token, data.calc ?? null));

export const takeMeOffList = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, reason: z.enum(["already_insulated", "price_too_high", "selling_moving", "changed_mind", "other"]).optional(), note: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data }) => (await import("./launch-campaign.server")).optOutCampaign(data.token, data.reason, data.note));

export const submitInsulationDeclaration = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token, confirmed: z.literal(true), declaration: z.enum(["loose_fill_only", "below_r2"]).optional() }).parse(d))
  .handler(async ({ data }) => (await import("./launch-campaign.server")).recordInsulationDeclaration(data.token, data.declaration, data.confirmed));

export const getLaunchCampaignOffice = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./launch-campaign.server")).launchCampaignOffice();
  });

export const saveDesktopInsulationCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ responseId: z.string().uuid(), outcome: z.enum(["looks_eligible", "not_eligible", "needs_onsite_check"]), reason: z.string().trim().max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./launch-campaign.server")).recordDeskCheck(data.responseId, data.outcome, data.reason, context.userId);
  });

export const getSavedSpot = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./launch-campaign.server")).savedSpotForJob(data.jobId);
  });

/** Jo 23 Oct 2026: "Tell us about your insulation" campaign — overview, preview, batch send (send refused until approved). */
export const insulationQuestionsOverviewFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batch: z.number().int().min(1).max(1000).default(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./insulation-questions-campaign.server")).questionsCampaignOverview(data.batch);
  });

export const insulationQuestionsPreviewFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./insulation-questions-campaign.server")).questionsCampaignPreview(data.jobId, context.userId);
  });

export const insulationQuestionsSendBatchFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./insulation-questions-campaign.server")).questionsCampaignSendBatch(data.jobIds, context.userId);
  });
