// Decision 389: the release step. Literal createServerFn chains (AGENTS). Office functions are admin only; the owner's
// three functions take only their secure My job link token (the ACTIVE step3_estimate customer_estimate_links row).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";
import { requireAdmin } from "./workflow.server";
import { requireOfficeJob, requireOfficeBusiness } from "./qa-office-access.server";

const token = z.string().max(200);

/** Office: the job's release state (Choose installer panel). */
export const getSpotRelease = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOfficeJob(context.supabase, data.jobId);
    const { spotReleaseStateFor } = await import("./spot-release.server");
    const { releaseStatusLine, releasable } = await import("./spot-release.core");
    const s = await spotReleaseStateFor(data.jobId);
    return { state: s.state, installer: s.state === "none" ? null : s.businessName, line: releaseStatusLine(s, Date.now()), releasable: releasable(s) };
  });

/** Office: Release the spot to one installer (or, for an owner who already confirmed, send the installer offer). */
export const releaseSpotFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), businessId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOfficeJob(context.supabase, data.jobId);
    await requireOfficeBusiness(context.supabase, data.businessId);
    const r = await (await import("./spot-release.server")).releaseSpot(data.jobId, context.userId, data.businessId);
    return { mode: r.mode, installer: r.installer };
  });

async function ownerJob(t: string): Promise<string | null> {
  const { isWellFormedToken, LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  if (!isWellFormedToken(t)) return null;
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: l } = await admin.from("customer_estimate_links").select("job_id, status, expires_at").eq("token", t).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  return l && linkUsable(l) ? l.job_id : null;
}
const dead = async () => { const { WorkflowError } = await import("./workflow.server"); return new WorkflowError("This link isn't working any more. Please reply to our email."); };

/** Owner: what `?screen=turn` shows. */
export const ownerTurnStateFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJob(data.token);
    if (!jobId) return null;
    return (await import("./spot-release.server")).ownerTurnState(jobId);
  });

/** Owner: "Yes, I'd still like my free Ready Check". */
export const ownerConfirmTurnFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJob(data.token);
    if (!jobId) throw await dead();
    return (await import("./spot-release.server")).confirmSpotRelease(jobId);
  });

/** Owner: "I'm no longer interested". */
export const ownerDeclineTurnFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token }).parse(d))
  .handler(async ({ data }) => {
    const jobId = await ownerJob(data.token);
    if (!jobId) throw await dead();
    return (await import("./spot-release.server")).declineSpotRelease(jobId);
  });
