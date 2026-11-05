// RPC surface for visit allocation (decision 161): the business owner reads the picker and allocates one visit.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getTeamElectricians = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: uuid }))
  .handler(async ({ data, context }) => (await import("./in-house-electrician.server")).electricianPicker(data.jobId, context.userId));
export const allocateElectricianFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: uuid, workerId: uuid }))
  .handler(async ({ data, context }) => (await import("./in-house-electrician.server")).allocateElectrician(data.jobId, context.userId, data.workerId));

/** Jo 5 Nov 2026: choose or change the safety-check electrician, with the time when there is one — saved together; the
 *  job-link text and the Mitti form go only after both saved; refused once the safety check is done. */
export const changeJobElectricianFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ jobId: uuid, workerId: uuid, start: z.string().datetime({ offset: true }).nullable().optional() }))
  .handler(async ({ data, context }) => (await import("./in-house-electrician.server")).changeJobElectrician(context.userId, { jobId: data.jobId, workerId: data.workerId, start: data.start ?? null }));

export const getVisitAllocation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./visit-allocation.server")).visitAllocationView(data.jobId, context.userId)));

export const allocateVisitFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["ready_check", "install"]), workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./visit-allocation.server")).allocateVisit(data.jobId, context.userId, data.kind, data.workerId));
