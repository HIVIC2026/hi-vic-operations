// P1-S23B — FFS minimum field progress/result server functions.
// Thin, validated entry points; every rule is enforced again in ./ffs-progress.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FFS_RESULT_VALUES } from "./ffs-progress.core";

const uuid = z.string().uuid();
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const recordFfsProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        jobId: uuid,
        result: z.enum(FFS_RESULT_VALUES as unknown as [string, ...string[]]),
        note: z.string().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    plain(
      await (
        await import("./ffs-progress.server")
      ).recordFfsProgress(context.userId, data.jobId, data),
    ),
  );

export const listFfsProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) =>
    plain(
      await (await import("./ffs-progress.server")).listFfsProgress(context.userId, data.jobId),
    ),
  );
