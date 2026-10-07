import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getTradeTexts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid().optional(), businessId: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return plain(await (await import("./daily-mitti-text.server")).listTradeTexts(data));
  });

export const sendDailyMittiTextTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import("./workflow.server");
    await requireAdmin(context.supabase);
    return plain(await (await import("./daily-mitti-text.server")).sendDailyTextTest(data.businessId, data.date));
  });
