// Task 9 (Jo 28 Oct 2026): the electrician repair price "Your price" card. Logic: electrician-repair-price-set.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** The card. Electrician staff (and anyone but the office or the electrician business owner) get null. */
export const getRepairPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { repairPriceView } = await import("./electrician-repair-price-set.server");
    return repairPriceView(context.supabase, data.jobId, context.userId);
  });

/** Office or the electrician business owner only (checked inside: requireJobRole + canPriceFixItems); append-only; never sends. */
export const setRepairPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, priceIncGst: z.union([z.number(), z.string().max(20)]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { setRepairPrice } = await import("./electrician-repair-price-set.server");
    const saved = await setRepairPrice(context.supabase, data.jobId, context.userId, data.priceIncGst);
    return { ok: true as const, setAt: saved.setAt };
  });
