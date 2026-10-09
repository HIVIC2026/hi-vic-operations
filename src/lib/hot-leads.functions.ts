import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getHotLeads = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ list: z.enum(["likely", "warm", "test"]).default("likely") }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const [leads, send] = await Promise.all([(await import("./hot-leads.server")).loadHotLeads(data.list), import("./hot-leads-send.server")]);
    return { ...leads, realSendingOn: await send.realSendingOn(), batchSize: send.HOT_SEND_BATCH };
  });

export const sendHotLeadsBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobIds: z.array(z.string().uuid()).min(1).max(10) }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./hot-leads-send.server")).sendSaveMySpot(data.jobIds, context.userId);
  });

export const editHotLeadEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid(), email: z.string().max(200), reason: z.string().max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./hot-leads-send.server")).updateHotLeadEmail(data.jobId, data.email, data.reason, context.userId);
  });

export const getPossibleDuplicates = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return (await import("./hot-leads.server")).loadPossibleDuplicates();
  });

/** /step3-email-preview "Send test" for Save your spot (likely eligible): TEST job only, Jo's allowlisted inbox only. */
export const sendSaveSpotPreviewTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobNumber: z.string().regex(/^HV-\d+$/).default("HV-1609"), subjectPrefix: z.string().max(80).optional(), variant: z.enum(["savespot", "likely"]).default("savespot") }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin.from("jobs").select("id, source").eq("job_number", data.jobNumber).maybeSingle();
    if (!job || job.source !== "qa_test") throw new Error("Test sends use TEST jobs only.");
    const { sendSaveMySpot, testSendIds } = await import("./hot-leads-send.server");
    const likely = data.variant === "likely";
    const [r] = await sendSaveMySpot([job.id], context.userId, { group: "likely", subjectPrefix: data.subjectPrefix ?? (likely ? "[TEST – STEP 3 LIKELY ELIGIBLE]" : "[TEST – STEP 3 SAVE YOUR SPOT]"), ...(likely ? { variant: "likely_estimate" as const } : {}) });
    return { ...r!, sendId: testSendIds.get(job.id) ?? null };
  });

/** Personalised preview of a real lead's Save my spot email. Renders only; never sends. */
export const previewHotLeadEmail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const [r] = await (await import("./hot-leads-send.server")).sendSaveMySpot([data.jobId], context.userId, { mode: "preview" });
    return r!;
  });

/** Sends one real lead's email to Jo's own inbox only (links point at a TEST job). */
export const sendHotLeadTestToJo = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const [r] = await (await import("./hot-leads-send.server")).sendSaveMySpot([data.jobId], context.userId, { mode: "test_to_jo" });
    return r!;
  });

/** Render-only twin of sendHotLeadTestToJo: same TEST-link preparation (fresh Group B TEST homeowner for Group B), never sends. */
export const previewHotLeadTestCopy = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const [r] = await (await import("./hot-leads-send.server")).sendSaveMySpot([data.jobId], context.userId, { mode: "test_preview" });
    return r!;
  });
