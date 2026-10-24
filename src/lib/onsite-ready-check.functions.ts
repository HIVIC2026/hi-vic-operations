import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plan = z.object({ mode: z.enum(["mine", "hivic", "job_by_job"]), business_id: uuid.nullable().optional(), nomination_id: uuid.nullable().optional() }).nullable();

/** Installer Add a job (decisions 34/115/116, Jo 24 Oct): basics + permission tick, optional visit day and time. */
export const startOnsiteReadyCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    owner: z.object({ full_name: z.string().max(200), address_line: z.string().max(300), suburb: z.string().max(100), postcode: z.string().max(10), phone: z.string().max(40), email: z.string().max(200), contact_permission: z.boolean(), consent_by: z.enum(["owner", "installer"]).nullable().optional(), address_verified: z.boolean().optional() }),
    electrician: plan.optional(),
    visit: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { startOnsiteReadyCheckFor } = await import("./onsite-ready-check.server");
    return startOnsiteReadyCheckFor(context.userId, data.businessId, data.owner, (data.electrician ?? { mode: "hivic" }) as never, undefined, { visit: data.visit ?? null });
  });

export const onsiteFormStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, retry: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { onsiteFormFor } = await import("./onsite-ready-check.server");
    return onsiteFormFor(data.jobId, context.userId, undefined, data.retry);
  });
