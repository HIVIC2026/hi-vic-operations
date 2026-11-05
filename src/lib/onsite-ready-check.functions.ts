import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** Installer Add a job (Task 7, installer screens): basics + the consent tick naming the installer + the Team electrician for the PIESA.
 *  Join ruling (4 Nov 2026): that Team electrician IS the installer's own electrician — the server derives the plan from the pick;
 *  no electrician plan (and never Home Insulation Victoria's electrician) is taken from the phone. */
export const startOnsiteReadyCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    owner: z.object({ full_name: z.string().max(200), address_line: z.string().max(300), suburb: z.string().max(100), postcode: z.string().max(10), phone: z.string().max(40), email: z.string().max(200), contact_permission: z.boolean(), consent_by: z.enum(["owner", "installer"]).nullable().optional(), address_verified: z.boolean().optional(), address_typed: z.boolean().optional() }),
    /** Task 7: the business's Team electrician for the PIESA — required. */
    electricianWorkerId: uuid,
    /** A1: how the installer got this customer. */
    leadOrigin: z.enum(["owner_contacted", "referral", "door_knock", "cold_call"]).nullable().optional(),
    /** A6: one key per phone draft, kept across retries and reloads, so "Try again" finishes the same job. */
    requestKey: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { startOnsiteReadyCheckFor } = await import("./onsite-ready-check.server");
    return startOnsiteReadyCheckFor(context.userId, data.businessId, data.owner, null, undefined, { electricianWorkerId: data.electricianWorkerId, leadOrigin: data.leadOrigin ?? null, requestKey: data.requestKey ?? null });
  });

/** Task 7: what Add a job needs before it renders — the business name (for the consent line) and its Team electricians. Read-only. */
export const addJobOptions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const c = await (await import("./trade-view.server")).pricesOrThrow(context.userId);
    const { WorkflowError } = await import("./workflow.server");
    if (c.biz.id !== data.businessId) throw new WorkflowError("You are not part of this business.");
    const electricians = await (await import("./in-house-electrician.server")).teamElectricianChoices(data.businessId);
    return { businessName: c.biz.name, electricians };
  });

export const addJobStart = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { myBusinesses } = await import("./pilot.server");
    const { addJobStartState } = await import("./add-job-flow.core");
    // Task 7: an Office person (Task 1 roles) may add jobs too; the pure rule decides from the memberships + that context.
    // Portal speed step 2: the memberships and the trade context are independent reads, so they run together (were one
    // after the other); same answers, the context's failure still reads as none and a membership failure still fails.
    const ctxP = import("./trade-view.server").then((m) => m.tradeContext(context.userId)).catch(() => null);
    const [businesses, ctx] = await Promise.all([myBusinesses(context.userId), ctxP]);
    return addJobStartState(businesses, ctx ? { businessId: ctx.biz.id, prices: ctx.prices } : null);
  });

export const onsiteFormStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, retry: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { onsiteFormFor } = await import("./onsite-ready-check.server");
    return onsiteFormFor(data.jobId, context.userId, undefined, data.retry);
  });
