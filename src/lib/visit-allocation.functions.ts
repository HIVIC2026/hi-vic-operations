// RPC surface for visit allocation (decision 161): the business owner reads the picker and allocates one visit.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getVisitAllocation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => plain(await (await import("./visit-allocation.server")).visitAllocationView(data.jobId, context.userId)));

export const allocateVisitFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["ready_check", "install"]), workerId: uuid }).parse(d))
  .handler(async ({ data, context }) => (await import("./visit-allocation.server")).allocateVisit(data.jobId, context.userId, data.kind, data.workerId));
