// RPC for cancellations, no-shows and arrivals. Rules in visit-events.core.ts; persistence in visit-events.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withRequestMeta } from "./request-meta";

const uuid = z.string().uuid();
const kind = z.enum(["ready_check", "assessment", "rectification", "installation"]);
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Booked visit summary for the signed-in owner or trade (times only). */
export const getVisitChangeState = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["owner", "electrician", "installer", "admin"]);
    const { visitChangeState } = await import("./visit-events.server");
    return plain(await visitChangeState(data.jobId));
  });

/** Owner (signed in): reschedule or cancel. Within 24h it counts as a no-show. */
export const ownerChangeVisitFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind, action: z.enum(["reschedule", "cancel"]), reason: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["owner"]);
    const { ownerChangeVisit } = await import("./visit-events.server");
    return plain(await ownerChangeVisit(data.jobId, data.kind, data.action, context.userId, data.reason ?? null));
  });

/** Owner (no-login estimate link): Ready Check booking summary. */
export const getReadyCheckVisitByToken = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { jobIdForToken } = await import("./readycheck-payment.server");
    const jobId = await jobIdForToken(data.token);
    if (!jobId) return null;
    const { visitChangeState } = await import("./visit-events.server");
    const s = await visitChangeState(jobId);
    return s && s.kind === "ready_check" ? plain({ starts_at: s.starts_at, ownerCanChange: s.ownerCanChange, started: s.started }) : null;
  });

/** Owner (no-login estimate link): reschedule or cancel the Ready Check. */
export const ownerChangeReadyCheckByToken = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d) => z.object({ token: z.string().max(200), action: z.enum(["reschedule", "cancel"]) }).parse(d))
  .handler(async ({ data }) => {
    const { jobIdForToken } = await import("./readycheck-payment.server");
    const jobId = await jobIdForToken(data.token);
    if (!jobId) throw new Error("This link is no longer valid.");
    const { ownerChangeVisit } = await import("./visit-events.server");
    return plain(await ownerChangeVisit(jobId, "ready_check", data.action, null, "Owner via estimate link"));
  });

/** Booked trade: "I've arrived", "Owner not home", or cancel. */
export const tradeVisitAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, action: z.enum(["arrived", "owner_not_home", "cancel"]), reason: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireJobRole, WorkflowError } = await import("./workflow.server");
    await requireJobRole(context.supabase, data.jobId, ["electrician", "installer"]);
    const s = await import("./visit-events.server");
    if (data.action === "arrived") return plain(await s.tradeArrived(data.jobId, context.userId));
    if (data.action === "owner_not_home") return plain(await s.tradeOwnerNotHome(data.jobId, context.userId, data.reason ?? null));
    if (!data.reason || data.reason.length < 5) throw new WorkflowError("Please give a short reason for cancelling.");
    return plain(await s.tradeCancelVisit(data.jobId, context.userId, data.reason));
  });

/** Office: list a job's visit events and clear a wrong no-show (reason required). */
export const listVisitEvents = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { data: rows, error } = await context.supabase.from("visit_events").select("id, visit_kind, event, counts_against, clears_event_id, reason, created_at, businesses(name)").eq("job_id", data.jobId).order("created_at", { ascending: false });
    if (error) throw new Error(`Could not load visit history: ${error.message}`);
    return plain(rows ?? []);
  });

export const clearNoShowFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ eventId: uuid, reason: z.string().trim().min(5).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    const { clearNoShow } = await import("./visit-events.server");
    return plain(await clearNoShow(data.eventId, context.userId, data.reason));
  });
