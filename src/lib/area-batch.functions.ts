// A48 batch 2: area batch Send (Jobs › Choose installer). Literal createServerFn chains
// (AGENTS); office only. A TEST office login sees and sends only its TEST jobs and TEST partners.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOfficeIdentity, requireOfficeJob, requireOfficeBusiness, officeTestJobIds, officeTestBusinessIds } from "./qa-office-access.server";

/** Office: Send — texts and emails every owner in the batch their quick taps link (`results`: each home's text and email
 *  result). Refused (nothing sent) if any home is already in a batch. */
export const sendAreaBatchFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(10), businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    for (const id of data.jobIds) await requireOfficeJob(context.supabase, id, context);
    await requireOfficeBusiness(context.supabase, data.businessId, context);
    const r = await (await import("./area-batch.server")).sendBatch(data.jobIds, data.businessId, context.userId);
    return { batchId: r.batchId, installer: r.installer, homes: r.homes, ...(r.batchId === "" ? { firmQuoteGiven: true } : {}), held: r.batchId === "" ? 0 : r.texts.filter((t) => t.status !== "sent" && t.status !== "not_texted").length,
      results: r.texts.map((t) => ({ jobId: t.jobId, text: { status: t.status, detail: t.detail }, email: t.email })) };
  });

/** Office (Task 6, Choose installer › To release): the installers who cover every ticked home. Read only. The same checks
 *  as sendAreaBatchFn: each job is an office job (a TEST office login only its TEST jobs); a TEST office login only sees
 *  its TEST partners. */
export const getInstallersForHomesFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ data, context }) => {
    for (const id of data.jobIds) await requireOfficeJob(context.supabase, id, context);
    const role = await requireOfficeIdentity(context.supabase, context);
    const { installersForHomes } = await import("./area-batch.server");
    if (role === "qa_office") return { installers: await installersForHomes(data.jobIds, await officeTestBusinessIds(context.supabase, context)) };
    return { installers: await installersForHomes(data.jobIds) };
  });

/** Office: closed batches whose owners said yes, waiting for Jo's "Send to installer" (or "Send again" when the installer's
 *  text didn't go), with the installers who could take them. Read only. */
export const getBatchesReadyToSend = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeTest: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase, context);
    const { batchesReadyToSend } = await import("./area-batch.server");
    if (role === "qa_office") return batchesReadyToSend({ includeTest: true, testJobIds: await officeTestJobIds(context.supabase, context), testBusinessIds: await officeTestBusinessIds(context.supabase, context) });
    return batchesReadyToSend({ includeTest: data.includeTest });
  });
