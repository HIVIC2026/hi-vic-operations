import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plan = z.object({ mode: z.enum(["mine", "hivic", "job_by_job"]), business_id: uuid.nullable().optional(), nomination_id: uuid.nullable().optional() }).nullable();

export const startOnsiteReadyCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    owner: z.object({ full_name: z.string().max(200), address_line: z.string().max(300), suburb: z.string().max(100), postcode: z.string().max(10), phone: z.string().max(40), email: z.string().max(200), contact_permission: z.boolean() }),
    electrician: plan,
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { startOnsiteReadyCheckFor } = await import("./onsite-ready-check.server");
    return startOnsiteReadyCheckFor(context.userId, data.businessId, data.owner, data.electrician as never);
  });

export const onsiteFormStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, retry: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { onsiteFormFor } = await import("./onsite-ready-check.server");
    return onsiteFormFor(data.jobId, context.userId, undefined, data.retry);
  });
