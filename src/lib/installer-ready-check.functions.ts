// RPCs for the installer-supplied Ready Check (Jo, 7 Oct 6pm). Logic: installer-ready-check.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const picks = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).min(1).max(5);

export const getInstallerRcState = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: j } = await context.supabase.from("jobs").select("id").eq("id", data.jobId).maybeSingle(); // RLS: only jobs they can see
    if (!j) return null;
    const { installerRcState } = await import("./installer-ready-check.server");
    return installerRcState(data.jobId);
  });

export const bookOwnReadyCheckFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, startsAt: z.string().min(10).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { bookOwnReadyCheck } = await import("./installer-ready-check.server");
    return bookOwnReadyCheck(data.jobId, context.userId, data.startsAt);
  });

export const askOwnerForReadyCheckTimesFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { askOwnerForReadyCheckTimes } = await import("./installer-ready-check.server");
    const r = await askOwnerForReadyCheckTimes(data.jobId, context.userId);
    return { ok: r.ok, delivery: r.delivery };
  });

export const takeOwnerReadyCheckTimeFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, windowId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { takeOwnerReadyCheckTime } = await import("./installer-ready-check.server");
    return takeOwnerReadyCheckTime(data.jobId, context.userId, data.windowId);
  });

/** Owner (no-login link). */
export const getOwnerTimesPage = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { ownerTimesPage } = await import("./installer-ready-check.server");
    return ownerTimesPage(data.token);
  });

export const submitOwnerTimes = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().max(200), picks }).parse(d))
  .handler(async ({ data }) => {
    const { jobForTimesToken } = await import("./installer-ready-check.server");
    const jobId = await jobForTimesToken(data.token);
    if (!jobId) throw new Error("This link is no longer active.");
    const { submitReadyCheckWindows } = await import("./readycheck-booking.server");
    await submitReadyCheckWindows(jobId, data.picks);
    return { ok: true };
  });
