import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { WorkflowError } from "./workflow.server";

const uuid = z.string().uuid();

export const joTradieAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ step: z.enum(["setup", "welcome", "job", "reminder", "all_clear", "status"]), jobId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new WorkflowError("Admin only.");
    const s = await import("./jo-tradie.server");
    if (data.step === "setup") return { result: await s.setupJoPartner(context.userId) };
    if (data.step === "welcome") return { result: await s.sendJoWelcome(context.userId) };
    if (data.step === "job") return { result: await s.createJoTestJob(context.userId) };
    if (data.step === "status") return { result: await s.joStatus() };
    if (!data.jobId) throw new WorkflowError("Pick the TEST job first.");
    if (data.step === "reminder") return { result: await s.joReminder(data.jobId, context.userId) };
    return { result: await s.simulateJoAllClear(data.jobId, context.userId) };
  });

export const getOfferView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./jo-tradie.server")).offerView(data.offerId, context.userId));

export const takeOfferTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, proposalId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./jo-tradie.server")).takeJoOffer(data.offerId, data.proposalId, context.userId));

export const getTradeDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./jo-tradie.server")).joDay(data.jobId, context.userId));

export const getTradeMoney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./jo-tradie.server")).tradeMoney(context.userId));

export const getTradeSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import("./jo-tradie.server")).tradeSetup(context.userId));
