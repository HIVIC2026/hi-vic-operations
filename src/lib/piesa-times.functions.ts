// Decision 333 (Jo, 25 Oct 2026): safety check (PIESA) times — the electrician offers 3, the owner takes one or suggests
// days, back and forth. Signed-in callers (electrician job page / offer page, owner portal). The no-login owner on the
// secure My job link uses owner-link.functions.ts. Rules: piesa-times.core.ts; writes: piesa-times.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
const picks = z.array(z.object({ day: ymd, time: hhmm })).length(3);
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getElectricianPiesaTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["electrician"]);
    return plain(await (await import("./piesa-times.server")).electricianPiesaTimesState(data.jobId, context.userId));
  });

export const electricianOfferPiesaTimesFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, picks }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["electrician"]);
    return (await import("./piesa-times.server")).electricianOfferPiesaTimes(data.jobId, context.userId, data.picks);
  });

export const electricianTakePiesaDayFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid, time: hhmm }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["electrician"]);
    return (await import("./piesa-times.server")).electricianTakeOwnerPiesaDay(data.jobId, data.proposalId, context.userId, data.time);
  });

/** Offer page: accept a PIESA offer by offering the owner 3 times (business-scoped in trade-view.server). */
export const offerTradePiesaTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, picks }).parse(d))
  .handler(async ({ data, context }) => (await import("./trade-view.server")).tradeOfferPiesaTimes(data.offerId, context.userId, data.picks));

// ---------- Owner portal (signed in) ----------
async function ownerOnly(supabase: Parameters<typeof import("./workflow.server").requireJobRole>[0], jobId: string, userId: string) {
  const { requireJobRole, WorkflowError } = await import("./workflow.server");
  await requireJobRole(supabase, jobId, ["owner"]);
  const { data: isOwner } = await supabase.rpc("is_job_owner", { _job: jobId, _user: userId });
  if (!isOwner) throw new WorkflowError("Only the owner can choose safety check times.");
}

export const getOwnerPiesaTimes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    return plain(await (await import("./piesa-times.server")).ownerPiesaTimesState(data.jobId));
  });

export const ownerTakePiesaTimeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: uuid, proposalId: uuid, understandsThirtyDays: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    return (await import("./piesa-times.server")).ownerTakePiesaTime(data.jobId, data.proposalId, context.userId, { understandsThirtyDays: data.understandsThirtyDays, ip: context.ip, userAgent: context.userAgent });
  });

export const ownerSuggestPiesaDaysFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: uuid, days: z.array(ymd).min(1).max(5), understandsThirtyDays: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.supabase, data.jobId, context.userId);
    return (await import("./piesa-times.server")).ownerSuggestPiesaDays(data.jobId, context.userId, data.days, { understandsThirtyDays: data.understandsThirtyDays, ip: context.ip, userAgent: context.userAgent });
  });
