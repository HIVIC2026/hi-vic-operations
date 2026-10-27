import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

/** Jo 24 Oct: the link that opens this exact Mitti form. Only for someone who can see the job the form belongs to. */
export const getMittiFormLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ auditId: z.string().trim().min(3).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const [{ data: m }, { data: a }] = await Promise.all([
      admin.from("ceiling_measurements").select("job_id").eq("external_source", "mitti").eq("external_id", data.auditId).limit(1).maybeSingle(),
      admin.from("assessments").select("job_id").eq("external_mitti_id", data.auditId).limit(1).maybeSingle(),
    ]);
    const jobId = m?.job_id ?? a?.job_id ?? null;
    if (!jobId) throw new Error("This Mitti form isn't linked to a job.");
    const { data: ok, error } = await (context.supabase as unknown as Rpc).rpc("can_access_job", { _job: jobId });
    if (error || !ok) throw new Error("Not your job.");
    if (data.auditId.startsWith("sim_")) {
      await (await import("./mitti-practice.server")).practiceForm(context.userId, jobId, data.auditId);
      return { url: `/field/practice/${jobId}/${encodeURIComponent(data.auditId)}`, deep: false as const };
    }
    const { mittiFormUrl, deepLinkFromResponse } = await import("./mitti-link.core");
    try {
      const { mittiApi } = await import("./mitti.core");
      const { realMittiCall } = await import("./mitti.server");
      const link = deepLinkFromResponse(await mittiApi(realMittiCall).deepLink(data.auditId));
      if (link) return { url: link, deep: true as const };
    } catch { /* Mitti unavailable: fall back to the web address */ }
    return { url: mittiFormUrl(data.auditId), deep: false as const };
  });
