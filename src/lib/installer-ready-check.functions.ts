// RPCs for the installer-supplied Ready Check (Jo, 7 Oct 6pm). Logic: installer-ready-check.server.ts.
// Decision 180 (Jo, 24 Oct 2026): the owner times link RPCs were retired; installers book the visit directly.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

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
