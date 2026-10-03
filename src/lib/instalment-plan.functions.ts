import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const officeAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approve") }),
  z.object({ kind: z.literal("record_collection"), arrangement: z.string().max(1000) }),
  z.object({ kind: z.literal("verify_first"), amount: z.number().positive().max(1_000_000) }),
  z.object({ kind: z.literal("mark"), status: z.enum(["failed", "overdue", "cancelled", "superseded"]), reason: z.string().max(2000) }),
]);

export const getOfficeInstalmentPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { officeView } = await import("./instalment-plan.server");
    return JSON.parse(JSON.stringify(await officeView(data.jobId)));
  });

export const proposeInstalmentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { proposePlan } = await import("./instalment-plan.server");
    return proposePlan(data.jobId, context.userId);
  });

export const officeInstalmentAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: uuid, action: officeAction }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { actOnPlan } = await import("./instalment-plan.server");
    return actOnPlan(data.planId, data.action, context.userId, false);
  });

export const getOwnerInstalmentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { assertOwner, ownerView } = await import("./instalment-plan.server");
    await assertOwner(data.jobId, context.userId);
    return JSON.parse(JSON.stringify(await ownerView(data.jobId)));
  });

export const acceptInstalmentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ planId: uuid, confirmed: z.literal(true) }).parse(d))
  .handler(async ({ data, context }) => {
    const { actOnPlan } = await import("./instalment-plan.server");
    return actOnPlan(data.planId, { kind: "owner_accept", confirmed: true }, context.userId, true);
  });
