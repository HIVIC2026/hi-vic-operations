// A48 batch 2, part 2: the installer's run. Literal createServerFn chains (AGENTS). Jo's "Send to installer" is office only
// (the TEST office login is refused — its Choose installer screen doesn't show batches); the run page functions are
// business-scoped through the trade context (only the run's own business).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOfficeIdentity } from "./qa-office-access.server";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Office: Jo taps "Send to installer" on a closed batch — the run goes to the installer she picked at Send. */
export const offerRunFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase);
    if (role === "qa_office") throw new Error("The TEST office login can't send runs to installers.");
    return plain(await (await import("./installer-run.server")).offerRun(data.batchId, context.userId));
  });

/** Installer: the run page (own business only). */
export const getTradeRun = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./installer-run.server")).tradeRun(data.runId, context.userId)));

/** Installer: take a home out of the run before choosing a day (back in the pool; the owner isn't told). */
export const removeTradeRunHome = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./installer-run.server")).removeRunHome(data.runId, data.jobId, context.userId));

/** Installer: say no to the run (back to Jo's suggestions; owners aren't asked again). */
export const declineTradeRun = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./installer-run.server")).declineRun(data.runId, context.userId));

/** Installer, Portal books: pick the day (≥ 2 days ahead), start time (default 8:00) and a second day when needed. */
export const chooseTradeRunDay = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), secondDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), personId: uuid.nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./installer-run.server")).chooseRunDay(data.runId, context.userId, data.day, data.start, data.secondDay, { personId: data.personId ?? null })));

/** Installer (Task 8): "Our team books" — their team calls the owners and enters each agreed time. */
export const chooseTradeRunTeam = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, personId: uuid.nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => (await import("./installer-run.server")).chooseTeamBooks(data.runId, context.userId, { personId: data.personId ?? null }));

/** Installer (Our team books): the day + exact time agreed with this owner (the owner gets the confirm text). */
export const enterTradeRunTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, jobId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => (await import("./installer-run.server")).enterTeamTime(data.runId, context.userId, data.jobId, data.day, data.time));

/** Installer (Task 8): move a Portal books run to a new day — every owner gets a new window to confirm. */
export const moveTradeRun = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), secondDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./installer-run.server")).moveRun(data.runId, context.userId, data.day, data.start, { secondDay: data.secondDay })));

/** Installer (Task 8): "Fill from nearby waiting owners" on a window an owner cancelled. */
export const fillTradeRunSlot = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: uuid, jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./installer-run.server")).fillCancelledSlot(data.runId, context.userId, data.jobId));
