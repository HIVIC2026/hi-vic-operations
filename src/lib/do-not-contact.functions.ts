import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

export const setDoNotContactFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid(), on: z.boolean(), note: z.string().trim().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { setDoNotContact } = await import("./do-not-contact.server");
    return setDoNotContact(data.jobId, context.userId, data.on, data.note ?? null);
  });
