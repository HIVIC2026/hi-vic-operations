import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

/** Office "Today" page: this morning's stored brief (if made) plus a live view right now. Admin only. */
export const getTodayBrief = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { melbourneYmd } = await import("./daily-brief.core");
    const { collectBrief } = await import("./daily-brief.server");
    const today = melbourneYmd(Date.now());
    const { data, error } = await admin.from("daily_briefs").select("brief_date, content, delivery_status, created_at").eq("brief_date", today).maybeSingle();
    if (error) throw new Error(`Could not load the daily brief: ${error.message}`);
    const live = await collectBrief(today);
    return { today, stored: data ? { createdAt: data.created_at, deliveryStatus: data.delivery_status } : null, brief: live };
  });
