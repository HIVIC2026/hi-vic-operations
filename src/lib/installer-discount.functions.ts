// Task 6 (Jo 5 Nov 2026): the Boss / Office offers a discount on the quote the owner already has (own customer jobs).
// Logic and every refusal: installer-discount.server.ts. Never sends anything to the owner.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const requestInstallerDiscountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      jobId: z.string().uuid(),
      amountIncGst: z.number().positive().max(1_000_000),
      note: z.string().max(500).optional().nullable(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { requestInstallerDiscount } = await import("./installer-discount.server");
    return requestInstallerDiscount(data.jobId, context.userId, data.amountIncGst, data.note ?? null);
  });
