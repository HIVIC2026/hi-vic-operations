import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { z } from "zod";
export const Route = createFileRoute("/api/public/save-spot-reminders")({ server: { handlers: {
  POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const body = z.object({ kind: z.literal("automatic") }).safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { runSaveSpotReminderBlast } = await import("@/lib/save-spot-reminder-blast.server");
    const r = await runSaveSpotReminderBlast(false,true);
    return Response.json({ processed: r.results.length, hasMore: r.hasMore, blocked: r.sendBlockers.length > 0 });
  },
} } });