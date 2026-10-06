import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

const token = z.string().max(200);

export const getLaunchCampaignPage = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data, context }) => (await import("./launch-campaign.server")).campaignPage(data.token, context.assessmentTestMode));

export const saveMySpot = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./launch-campaign.server")).saveCampaignSpot(data.token));

export const takeMeOffList = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./launch-campaign.server")).optOutCampaign(data.token));

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
