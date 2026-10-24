// Decision 278: the business owner's price on an installer-supplied job. Logic: installer-price.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** The "Your price" card. Team members (and anyone else) get null — nothing about the price reaches them. */
export const getInstallerPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerPriceView } = await import("./installer-price-set.server");
    return installerPriceView(data.jobId, context.userId);
  });

/** Business admin only (requireMember(..., true) inside); append-only event; never sends. */
export const setInstallerPriceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid,
    priceIncGst: z.union([z.number(), z.string().max(20)]),
    included: z.array(z.string().max(80)).max(10),
    includedOther: z.string().max(300).optional().nullable(),
    electrician: z.enum(["hivic", "usual", "different"]).nullable(),
    different: z.object({ name: z.string().max(120).optional().nullable(), licence: z.string().max(60).optional().nullable(), priceIncGst: z.union([z.number(), z.string().max(20)]).optional().nullable() }).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { setInstallerPrice } = await import("./installer-price-set.server");
    const { jobId, ...input } = data;
    const saved = await setInstallerPrice(jobId, context.userId, input);
    return { ok: true as const, setAt: saved.setAt };
  });
