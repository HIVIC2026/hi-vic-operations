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
  .inputValidator((d) => z.object({ key: z.enum(["details", "rates", "bank", "alerts", "mitti", "team"]), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeSetupMark(context.userId, data.key, data.done));
