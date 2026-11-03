// Decision 278: the business owner's price on an installer-supplied job. Logic: installer-price.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** The "Your price" card. Team members (and anyone else) get null — nothing about the price reaches them. */
export const getInstallerPriceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { installerPriceView } = await import("./installer-price-set.server");
    return installerPriceView(data.jobId, context.userId);
  });

/** Boss or Office (canEnterPrice inside); append-only event. `send` = "Send quote to owner" (Task 4): releases through the
 *  guarded auto-send only while OWN_CUSTOMER_SEND_ON_PRESS_ENABLED; otherwise it only saves. */
export const setInstallerPriceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        jobId: uuid,
        priceIncGst: z.union([z.number(), z.string().max(20)]),
        included: z.array(z.string().max(80)).max(10),
        includedOther: z.string().max(300).optional().nullable(),
        productOption: z.string().max(80).optional().nullable(),
        notes: z.string().max(1000).optional().nullable(),
        send: z.boolean().optional(),
        // Decision 289: no electrician fields — chosen once at Add a job.
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { setInstallerPrice } = await import("./installer-price-set.server");
    const { jobId, send, ...input } = data;
    const r = await setInstallerPrice(jobId, context.userId, input, { send: send === true });
    return { ok: true as const, setAt: r.stored.setAt, sent: r.sent, reasons: r.reasons };
  });

/** Jo 28 Oct 2026: one-way switch to Home Insulation Victoria's electrician; business admin only (checked inside). */
export const switchToHivElectricianFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { switchToHivElectrician } = await import("./installer-price-set.server");
    return switchToHivElectrician(data.jobId, context.userId);
  });
