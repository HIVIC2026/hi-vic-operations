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
