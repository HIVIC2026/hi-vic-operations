// Portal Ready Check draft RPCs. Caller must access the job AND belong to its supplying/assigned installer business (or be admin).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getReadyCheckDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) { const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz }); if (!mem) throw new Error("Not your job."); }
    const { loadRcDraft } = await import("./ready-check-draft.server");
    return loadRcDraft(data.jobId);
  });

export const saveReadyCheckDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), values: z.record(z.string().max(80), z.string().max(2000)) }).parse(d))
  .handler(async ({ data, context }) => {
    void data; void context;
    throw new Error("Ready Checks are now done only in the Mitti form. Please open the job's Mitti Ready Check.");
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    if (!biz) throw new Error("No installer business is assigned to this job.");
    const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz });
    if (!mem) throw new Error("Only the job's installer business can save its Ready Check.");
    const { saveRcDraft } = await import("./ready-check-draft.server");
    return saveRcDraft(data.jobId, context.userId, biz, data.values);
  });

/** P1: explicit "Submit for review" — same caller rule as save (the job's installer business only). */
export const submitReadyCheckDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    void data; void context;
    throw new Error("Ready Checks are now done only in the Mitti form. Please open the job's Mitti Ready Check.");
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    if (!biz) throw new Error("No installer business is assigned to this job.");
    const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz });
    if (!mem) throw new Error("Only the job's installer business can submit its Ready Check.");
    const { submitRcDraft } = await import("./ready-check-draft.server");
    return submitRcDraft(data.jobId, context.userId);
  });

/** Office only: reopen a submitted portal Ready Check for correction (see reopenRcDraft). */
export const reopenReadyCheckDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { reopenRcDraft } = await import("./ready-check-draft.server");
    return reopenRcDraft(data.jobId, context.userId, data.reason);
  });

const area = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/), label: z.string().trim().min(1).max(80),
  areaM2: z.number().nonnegative().nullable(), existing: z.enum(["none", "present", "unknown"]).nullable(), rValue: z.number().nonnegative().nullable(),
  removal: z.enum(["yes", "no", "unknown"]).nullable(), removalM2: z.number().nonnegative().nullable(),
  product: z.string().max(200).nullable(), scope: z.string().max(2000).nullable(),
}).transform((a) => ({ ...a, sources: {} })); // client-sent provenance is ignored; the server attributes every fact

/** Ceiling areas on the draft Ready Check — same caller rule as save (the job's installer business only). */
export const saveReadyCheckAreas = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), areas: z.array(area).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    void data; void context;
    throw new Error("Ready Checks are now done only in the Mitti form. Please open the job's Mitti Ready Check.");
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    if (!biz) throw new Error("No installer business is assigned to this job.");
    const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz });
    if (!mem) throw new Error("Only the job's installer business can save its Ready Check.");
    const { saveRcAreas } = await import("./ready-check-draft.server");
    return saveRcAreas(data.jobId, context.userId, biz, data.areas);
  });

/** Office only: dated correction version of a submitted Ready Check (the submitted version stays unchanged). */
export const startReadyCheckCorrection = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { startRcCorrection } = await import("./ready-check-draft.server");
    return startRcCorrection(data.jobId, context.userId, data.reason);
  });
