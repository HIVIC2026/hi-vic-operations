// A5 PIISA crew picker RPCs. Scoped: caller must access the job AND be a member of its assigned installer business (or admin).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const pick = z.union([z.object({ workerId: z.string().uuid() }), z.object({ other: z.object({ name: z.string().trim().min(1).max(200), eec: z.string().trim().min(1).max(60) }) })]);

export const getPiisaCrew = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness, loadCrew } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!admin) { const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz }); if (!mem) throw new Error("Not your job."); }
    return loadCrew(data.jobId);
  });

export const savePiisaCrew = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), lead: z.union([z.string().uuid(), z.object({ other: z.object({ name: z.string().trim().min(1).max(200), eec: z.string().trim().min(1).max(60) }) })]).nullable(), additional: z.array(pick).max(3) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok, error } = await context.supabase.rpc("can_access_job", { _job: data.jobId });
    if (error || !ok) throw new Error("Not your job.");
    const { assignedInstallerBusiness, saveCrewSelection } = await import("./piisa-a3.server");
    const biz = await assignedInstallerBusiness(data.jobId);
    const { data: admin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!admin) { const { data: mem } = await context.supabase.rpc("is_business_member", { _biz: biz }); if (!mem) throw new Error("Not your job."); }
    return saveCrewSelection(data.jobId, context.userId, { lead: data.lead, additional: data.additional });
  });
