// Jo 3 Nov 2026: installer job page — the one electrician question on a Mitti pickup (own electricians only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

export const getMittiElectricianQuestion = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { mittiElectricianQuestionFor } = await import("./mitti-electrician.server");
    try { return await mittiElectricianQuestionFor(data.jobId, context.userId); } catch { return { open: false, businessId: null }; }
  });

export const answerMittiElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, plan: z.object({ mode: z.literal("mine"), business_id: uuid.nullish(), nomination_id: uuid.nullish() }) }).parse(d))
  .handler(async ({ data, context }) => {
    const { answerMittiElectricianQuestion } = await import("./mitti-electrician.server");
    await answerMittiElectricianQuestion(data.jobId, context.userId, { mode: "mine", business_id: data.plan.business_id ?? null, nomination_id: data.plan.nomination_id ?? null });
    return { ok: true as const };
  });
