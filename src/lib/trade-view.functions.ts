import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getTradeHome = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeHome(context.userId).catch((e: Error) => { if (/isn't linked/.test(e.message)) return null; throw e; })));

export const getTradeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeOffer(data.offerId, context.userId)));

export const takeTradeTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, windowId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeTakeTime(data.offerId, data.windowId, context.userId));

export const replyTradeOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, reply: z.enum(["not_for_me", "cant_make"]), note: z.string().max(300).nullable() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeOfferReply(data.offerId, context.userId, data.reply, data.note));

export const getTradeDayView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeDay(data.jobId, context.userId)));

export const tradeCouldntGetInFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().max(60) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeCouldntGetIn(data.jobId, data.reason, context.userId));

export const confirmHivicReadyCheckPricingFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).confirmHivicReadyCheckPricing(data.jobId, context.userId));

export const getTradeMoneyView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeMoney(context.userId)));

export const getTradeBusiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeBusiness(context.userId)));

export const setTradeTaking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taking: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetTaking(context.userId, data.taking));

export const getTradeSetupView = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeSetup(context.userId)));

export const markTradeSetup = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ key: z.enum(["details", "rates", "bank", "alerts", "team"]), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetupMark(context.userId, data.key, data.done));

export const getTradeBusinessFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeBusinessFile(context.userId)));


export const saveTradeUsualElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(200), licence: z.string().trim().min(1).max(100), priceIncGst: z.number().finite().min(0).max(1_000_000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSaveUsualElectrician(context.userId, data));

export const getTradeAgreementPdf = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./trade-view.server")).tradeAgreementPdf(context.userId));

export const sendTradeChangeRequest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ kind: z.enum(["details", "rates", "area", "other"]), message: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeChangeRequest(context.userId, data.kind, data.message));

export const testSetPasswordLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ base: z.string().url().max(200) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeTestSetPasswordLink(context.userId, data.base));

export const requestTeamLoginInvite = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeRequestLoginInvite(context.userId, data.workerId));

export const getMyMittiInvited = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./trade-view.server")).tradeMittiInvited(context.userId));

export const getMittiJobPresentation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ context, data }) => (await import("./mitti-job-presentation.server")).mittiJobPresentation(data.jobId, context.userId));

export const setPartnerMittiInvited = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid(), invited: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./trade-view.server")).setMittiInvited(context.userId, data.businessId, data.invited);
  });

export const getPartnerMittiInvited = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { data: b, error } = await context.supabase.from("businesses").select("mitti_account_invited, mitti_account_invited_at").eq("id", data.businessId).maybeSingle();
    if (error) throw new Error(error.message);
    return { invited: b?.mitti_account_invited === true, at: b?.mitti_account_invited_at ?? null };
  });

export const getTradeJobStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./job-status.server")).tradeJobStatus(context.userId, data.jobId)));

export const askTradeReminder = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./job-status.server")).tradeAskReminder(context.userId, data.jobId));

