// Decision 378: the "Choose installer" list (Jobs › Choose installer). Literal createServerFn chain (AGENTS); admin only;
// read-only — the Choose installer button opens the existing guarded flow (offer-dispatch.functions), nothing here sends.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { requireOfficeIdentity, officeTestJobIds, officeTestBusinessIds } from "./qa-office-access.server";

export const getInstallerWaitingList = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ includeTest: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const role = await requireOfficeIdentity(context.supabase);
    const { loadInstallerWaitingList } = await import("./installer-waiting.server");
    if (role === "qa_office") return loadInstallerWaitingList({ includeTest: true }, await officeTestJobIds(context.supabase), await officeTestBusinessIds(context.supabase));
    return loadInstallerWaitingList(data);
  });
