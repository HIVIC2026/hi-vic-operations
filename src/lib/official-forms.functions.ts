import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Office panel: PIISA responsible role, due state, next action and blockers (read-only). */
export const getPiisaPanel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { piisaPanel } = await import("./official-forms.server");
    const { todayMelbourne } = await import("./eligibility.server");
    return piisaPanel(data.jobId, todayMelbourne());
  });

/** Office preview of the PIESA/PIISA pre-fills, reminders and cross-checks for a job (read-only). */
export const getOfficialPrefill = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), key: z.enum(["piesa", "piisa"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { officialPrefillContext } = await import("./official-forms.server");
    const { todayMelbourne } = await import("./eligibility.server");
    const { officialPrefill, seedAnswers } = await import("./official-prefill.core");
    const hints = officialPrefill(data.key, await officialPrefillContext(data.jobId, todayMelbourne(), null));
    return { hints, seed: seedAnswers(hints) };
  });

/** Office invalidates a stale signed copy (reason required, permanent). */
export const invalidateOfficialCopy = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { invalidateCopy } = await import("./official-forms.server");
    await invalidateCopy(data.id, data.reason, context.userId);
    return { ok: true };
  });

/** Server-issued 5-minute link; RLS on the caller's own client decides visibility. */
export const officialCopyLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { signedCopyUrl } = await import("./official-forms.server");
    return { url: await signedCopyUrl(context.supabase as never, data.id) };
  });

/** Office records a verified rectification for one PIESA hazard (evidence and explicit CES answer required). */
export const verifyHazardRectification = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: z.string().uuid(), hazardKey: z.string().regex(/^(appliance|other)#\d+$/), rectificationItemId: z.string().uuid(),
    evidenceFileIds: z.array(z.string().uuid()).min(1), cesRequired: z.boolean(),
    cesNumber: z.string().trim().max(100).nullable(), cesEvidenceFileId: z.string().uuid().nullable(), notes: z.string().trim().max(1000).nullable(),
  }).refine((v) => !v.cesRequired || (!!v.cesNumber && !!v.cesEvidenceFileId), "A Certificate of Electrical Safety number and copy are required.").parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { recordHazardVerification } = await import("./official-forms.server");
    return { id: await recordHazardVerification({ ...data, actor: context.userId }) };
  });

/** Office supersedes a hazard verification (reason required); the hazard reopens. */
export const supersedeHazardRectification = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { supersedeHazardVerification } = await import("./official-forms.server");
    await supersedeHazardVerification(data.id, data.reason, context.userId);
    return { ok: true };
  });

/** Office downloads the filled official Word form for the job's current signed PIESA/PIISA. */
export const downloadOfficialDocx = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), key: z.enum(["piesa", "piisa"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { storeOfficialDocx, officialDocxUrl } = await import("./official-docx.server");
    const r = await storeOfficialDocx(data.jobId, data.key);
    const url = await officialDocxUrl(context.supabase as never, data.jobId, data.key);
    return { url, missed: r.missed, filled: r.filled };
  });

/** Office sends the official PIISA to the assigned installer in Mitti (blocked while the form is locked). */
export const sendPiisaToInstaller = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { createPiisaMittiAudit, realMittiCall } = await import("./mitti.server");
    // Same as the PIESA button: the office's explicit action may supersede an earlier attempt whose result is unknown
    // (>= 10 min old, recorded), so a lost reply never leaves the install-day form stuck.
    return createPiisaMittiAudit(data.jobId, context.userId, realMittiCall, { officeOverride: true });
  });
