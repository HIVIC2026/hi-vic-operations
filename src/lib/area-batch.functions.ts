// A48 batch 2: area batch suggestions and Jo's one-tap Send (Jobs › Choose installer). Literal createServerFn chains
// (AGENTS); office only. A TEST office login sees and sends only its TEST jobs and TEST partners.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOfficeIdentity, requireOfficeJob, requireOfficeBusiness, officeTestJobIds, officeTestBusinessIds } from "./qa-office-access.server";

/** Office: suggested batches with the installers who cover every home. Fills a few missing locations per load. */
export const getAreaBatchSuggestions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeTest: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase);
    const { batchSuggestions } = await import("./area-batch.server");
    if (role === "qa_office") return batchSuggestions({ includeTest: true, testJobIds: await officeTestJobIds(context.supabase), testBusinessIds: await officeTestBusinessIds(context.supabase) });
    return batchSuggestions({ includeTest: data.includeTest });
  });

/** Office: Send — texts every owner in the batch their quick taps link. Refused (nothing sent) if any home is already in a batch. */
export const sendAreaBatchFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(10), businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    for (const id of data.jobIds) await requireOfficeJob(context.supabase, id);
    await requireOfficeBusiness(context.supabase, data.businessId);
    const r = await (await import("./area-batch.server")).sendBatch(data.jobIds, data.businessId, context.userId);
    return { batchId: r.batchId, installer: r.installer, homes: r.homes, held: r.texts.filter((t) => t.status !== "sent").length };
  });

/** Office: closed batches whose owners said yes, waiting for Jo's "Send to installer" (Task 6 wires the send). Read only. */
export const getBatchesReadyToSend = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeTest: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase);
    const { batchesReadyToSend } = await import("./area-batch.server");
    if (role === "qa_office") return batchesReadyToSend({ includeTest: true, testJobIds: await officeTestJobIds(context.supabase) });
    return batchesReadyToSend({ includeTest: data.includeTest });
  });
