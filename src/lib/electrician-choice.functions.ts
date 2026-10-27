// Jo 28 Oct 2026 (spec rule 3): the installer's "Use Home Insulation Victoria's electrician ($349) instead" button.
// Logic: electrician-switch.server.ts (business owner of the job's installer business only; final; never sends).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const switchToHivicElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { switchToHivicElectricianFor } = await import("./electrician-switch.server");
    return switchToHivicElectricianFor(data.jobId, context.userId);
  });
