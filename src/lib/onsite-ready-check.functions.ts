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
    /** Decision 289: "Electrical safety check by" — chosen once here, never asked again. */
    electricianChoice: z.enum(["hivic", "usual"]).nullable().optional(),
    /** A1: how the installer got this customer. */
    leadOrigin: z.enum(["owner_contacted", "referral", "door_knock", "cold_call"]).nullable().optional(),
    visit: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { startOnsiteReadyCheckFor } = await import("./onsite-ready-check.server");
    return startOnsiteReadyCheckFor(context.userId, data.businessId, data.owner, (data.electrician ?? { mode: "hivic" }) as never, undefined, { visit: data.visit ?? null, electricianChoice: data.electricianChoice ?? null, leadOrigin: data.leadOrigin ?? null });
  });

/** Decision 289: what Add a job needs before it renders — the business's usual electrician (My business), if any. Read-only. */
export const addJobOptions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireMember } = await import("./pilot.server");
    await requireMember(context.userId, data.businessId);
    const { electrician } = await (await import("./usual-electrician.server")).readUsualElectrician(data.businessId);
    return { usualElectrician: electrician ? { name: electrician.name } : null };
  });

export const onsiteFormStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, retry: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { onsiteFormFor } = await import("./onsite-ready-check.server");
    return onsiteFormFor(data.jobId, context.userId, undefined, data.retry);
  });
