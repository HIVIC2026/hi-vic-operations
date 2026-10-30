import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const takeBackInHouseJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(1).max(2000) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await (await import("./in-house-batch.server")).pullBackInHouseJob({ ...data, actorId: context.userId });
    return { ok: true };
  });

export const getInHouseBatches = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  return (await import("./in-house-batch.server")).loadInHouseBatches();
});
export const allocateInHouseBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ businessId: z.string().uuid(), jobIds: z.array(z.string().uuid()).min(1).max(100) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return (await import("./in-house-batch.server")).sendInHouseBatch({ ...data, actorId: context.userId });
  });