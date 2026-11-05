import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { requireOfficeIdentity, requireOfficeJob, requireOfficeBusiness, officeTestBusinessIds, type OfficeRequestContext } from "./qa-office-access.server";
import { TEST_GIVE_REFUSED } from "./in-house-batch.core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** TEST office Give (Jo 5 Nov 2026): every job must pass the TEST-office job guard and the business the TEST-business
 *  guard, or the whole request is refused with one plain message. Only this checked scope reaches the server. */
async function testOfficeGiveScope(sb: SupabaseClient<Database>, ctx: OfficeRequestContext, jobIds: string[], businessId: string) {
  const ids = [...new Set(jobIds)];
  try {
    for (const jobId of ids) await requireOfficeJob(sb, jobId, ctx);
    await requireOfficeBusiness(sb, businessId, ctx);
  } catch { throw new Error(TEST_GIVE_REFUSED); }
  return { jobIds: ids, businessIds: [businessId] };
}

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
    // Real office: admin-bound exactly as before (never qa_test). TEST office: TEST jobs to TEST partners only.
    const role = await requireOfficeIdentity(context.supabase, context);
    if (role !== "qa_office") return (await import("./in-house-batch.server")).sendInHouseBatch({ ...data, actorId: context.userId });
    const testOffice = await testOfficeGiveScope(context.supabase, context, data.jobIds, data.businessId);
    return (await import("./in-house-batch.server")).sendInHouseBatch({ ...data, actorId: context.userId }, { testOffice });
  });
export const getInHouseGiveForJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase, context);
    if (role !== "qa_office") return (await import("./in-house-batch.server")).inHouseGiveForJob(data.jobId);
    try { await requireOfficeJob(context.supabase, data.jobId, context); } catch { throw new Error(TEST_GIVE_REFUSED); }
    const businessIds = await officeTestBusinessIds(context.supabase, context);
    return (await import("./in-house-batch.server")).inHouseGiveForJob(data.jobId, { testOffice: { jobIds: [data.jobId], businessIds } });
  });
