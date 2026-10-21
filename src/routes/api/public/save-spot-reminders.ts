import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { z } from "zod";
export const Route = createFileRoute("/api/public/save-spot-reminders")({ server: { handlers: {
  POST: async ({ request }) => {
    const failure = await authenticateCronRequest(request);
    if (failure) return failure;
    const body = z.object({ kind: z.literal("automatic") }).safeParse(await request.json().catch(() => null));
    if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    const { reminderSettings } = await import("@/lib/save-spot-reminder-settings.server");
    const settings = await reminderSettings();
    if (!settings.enabled || !settings.activatedAt) return Response.json({ enabled: false });
    const { runAfterResponse } = await import("@/lib/background.server");
    const mode = runAfterResponse(async () => {
      const { runSaveSpotReminderBlast } = await import("@/lib/save-spot-reminder-blast.server");
      await runSaveSpotReminderBlast(false,true);
    });
    return Response.json({ enabled: true, accepted: mode !== "queue_only" });
  },
} } });