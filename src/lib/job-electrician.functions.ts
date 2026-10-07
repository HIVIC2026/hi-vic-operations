// RPC for the job page electrician choice. Delegates to job-electrician.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getJobElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("can_access_job", { _job: data.jobId } as never);
    if (!ok) throw new Error("This job isn't available to you.");
    const { jobElectricianState } = await import("./job-electrician.server");
    return jobElectricianState(data.jobId);
  });

export const switchJobElectricianToHivic = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { switchJobToHivic } = await import("./job-electrician.server");
    return switchJobToHivic(data.jobId, context.userId);
  });
