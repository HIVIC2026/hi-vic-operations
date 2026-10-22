import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { withRequestMeta } from "./request-meta";

const uuid = z.string().uuid();
const token = z.string().max(200);

/** Office: record the append-only preliminary review bound to the owner's genuine inbound email. Sends nothing. */
export const recordEmailPreliminaryReviewFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: uuid, communicationId: uuid, reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recordEmailPreliminaryReview } = await import("./email-preliminary-offer.server");
    return recordEmailPreliminaryReview(data.jobId, context.userId, { communicationId: data.communicationId, reason: data.reason });
  });

/** Office: inbound owner emails recorded on the job (picker for the offer action). Read-only. */
export const getJobInboundEmailsFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { listJobInboundEmails } = await import("./email-preliminary-offer.server");
    return listJobInboundEmails(data.jobId);
  });

/** Office: preview then individually send the approved preliminary invitation. No send from review alone. */
export const preliminarySaveSpotOfferFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: uuid, mode: z.enum(["preview", "send"]), reviewId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { preliminarySaveSpotOffer } = await import("./email-preliminary-offer.server");
    return preliminarySaveSpotOffer(data.jobId, context.userId, data.mode, data.reviewId);
  });

/** Owner landing read on the secure link. Read-only; the link token is the capability. */
export const getPreliminarySavePageFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./email-preliminary-offer.server")).preliminarySavePage(data.token));

/** Owner's explicit POST on the secure link. Saves once; never a made-up area, price or rebate. */
export const savePreliminarySpotFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./email-preliminary-offer.server")).savePreliminarySpot(data.token));
