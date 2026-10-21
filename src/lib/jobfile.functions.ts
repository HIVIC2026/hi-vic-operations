import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin, requireJobRole } from "./workflow.server";
import { signFile } from "./file-links.server";

const uuid = z.string().uuid();

export const getJobFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    const { buildJobFile } = await import("./jobfile.server");
    return buildJobFile(data.jobId, role as never);
  });

export const getJobFileHeader = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, includeReadiness: z.boolean().default(true) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { installReadiness } = await import("./esc.server");
    const [{ data: esc }, ready] = await Promise.all([
      supabaseAdmin.from("esc_notifications").select("status, due_by").eq("job_id", data.jobId).not("status", "in", "(cancelled,stale)").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      data.includeReadiness ? installReadiness(data.jobId).catch(() => null) : Promise.resolve(null),
    ]);
    return { escDueBy: esc?.due_by ?? null, escStatus: esc?.status ?? null, ready: ready ? JSON.parse(JSON.stringify(ready)) as { ready: boolean; blockers: string[] } : null };
  });

/** Identity needs the same latest consent, not the intake's signed media or queue reads. */
export const getJobContactConsent = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: consents, error } = await supabaseAdmin.from("owner_contact_consents")
      .select("consent_status, consent_version, consented_at, age_confirmed, assistance, contact_preference, created_at, sha256")
      .eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(`Contact consent could not load: ${error.message}`);
    return { consent: consents?.[0] ?? null };
  });

export const logCommunication = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid, direction: z.enum(["inbound", "outbound", "internal"]), channel: z.enum(["phone", "email", "sms", "note", "whatsapp", "other"]),
    party: z.string().trim().max(200).optional(), subject: z.string().trim().max(300).optional(), body: z.string().trim().min(2).max(10000),
    at: z.string().datetime().optional(), visibility: z.enum(["customer", "trade", "internal"]),
    providerMessageId: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recordCommunication } = await import("./comms.server");
    // Record only – a logged call/email never sends anything.
    return { id: await recordCommunication({ jobId: data.jobId, direction: data.direction, channel: data.channel, senderText: data.direction === "inbound" ? data.party ?? null : "Home Insulation Victoria",
      recipients: data.direction === "outbound" && data.party ? [data.party] : [], subject: data.subject ?? null, body: data.body, at: data.at ?? null, visibility: data.visibility,
      sourceEvent: "manual_log", createdBy: context.userId,
      ...(data.providerMessageId ? { provider: "resend", providerMessageId: data.providerMessageId, deliveryStatus: "sent" as const } : {}) }) };
  });

export const exportJobPackFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, includeSuperseded: z.boolean().default(false), includeInternal: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { exportJobPack } = await import("./jobfile.server");
    return exportJobPack(data.jobId, context.userId, { includeSuperseded: data.includeSuperseded, includeInternal: data.includeInternal });
  });

/** Short-lived signed link for one indexed file, only if the caller's role may see it. */
export const openJobDocument = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, docId: z.string().min(3).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    const { loadSources } = await import("./jobfile.server");
    const { authorizedStoredDoc } = await import("./jobfile.core");
    const doc = authorizedStoredDoc(await loadSources(data.jobId), role as never, data.docId);
    if (!doc?.storagePath) throw new Error("This document has no stored file you can open.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s, error } = await signFile("job-files", doc.storagePath, 300);
    if (error || !s) throw new Error("Could not open the file.");
    return { url: s.signedUrl };
  });
