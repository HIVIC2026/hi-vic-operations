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

const rcPicks = z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) })).length(3);

/** Jo 24 Oct 2026: accept a Ready Check offer by offering the owner 3 times. */
export const offerTradeReadyCheckTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, picks: rcPicks }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeOfferReadyCheckTimes(data.offerId, context.userId, data.picks));

export const getTradeReadyCheckTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeReadyCheckTimes(data.jobId, context.userId)));

export const offerTradeReadyCheckNewTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, picks: rcPicks }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckOfferNew(data.jobId, context.userId, data.picks));

export const takeTradeReadyCheckDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid, time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckTakeDay(data.jobId, data.proposalId, data.time, context.userId));

/** Decision 80: installer "Change time" on a booked our-lead Ready Check — new day + time, rebooked directly. */
export const changeTradeReadyCheckTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeReadyCheckChange(data.jobId, { day: data.day, time: data.time }, context.userId));

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

/** ESC collection notice: the business's installers and their acknowledgement state (boss sees all; a worker only their own row). */
export const getTradeCollectionNotice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./esc-collection-notice-send.server")).tradeNoticeView(context.userId)));

/** The signed-in installer acknowledges the current notice for themself (append-only; never on someone's behalf). */
export const acknowledgeTradeCollectionNotice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./esc-collection-notice-send.server")).tradeAcknowledgeNotice(context.userId)));

/** Business owner (own business) or office: send / re-send one installer person's secure notice link by text + email (guarded senders). */
export const sendCollectionNoticeLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    return plain(await (await import("./esc-collection-notice-send.server")).sendNoticeLinkFor(context.userId, data.workerId, isAdmin === true));
  });

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

/** Jo 24 Oct 2026 (decision 110): A1 installer enters the Ready Check day + time (same slots as the owner's times link). */
export const setA1ReadyCheckTimeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetReadyCheckTime(context.userId, data.jobId, { day: data.day, time: data.time }));

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

/** Installer Job page (M2), Today's job extras (M4) and Money extras (M6) — decisions 196–203. Business-scoped reads. */
export const getTradeJobPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeJobPage(data.jobId, context.userId)));

export const getTradeDayExtras = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeDayExtras(data.jobId, context.userId)));

export const getTradeMoneyExtras = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => plain(await (await import("./trade-view.server")).tradeMoneyExtras(context.userId)));

/** M6 per-job pay detail (approved state M6-job-detail): business owner only, own pay only. */
export const getTradeMoneyJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeMoneyJob(data.jobId, context.userId)));


/** Decision 261: the safety plan (SWMS) on the installer's job page. */
export const getTradeSwms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./trade-view.server")).tradeSwms(data.jobId, context.userId)));

export const saveTradeSwmsNote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, note: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwmsNote(data.jobId, context.userId, data.note));

export const signTradeSwms = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, key: z.string().min(3).max(200), typedName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSwmsSign(data.jobId, context.userId, data.key, data.typedName));
