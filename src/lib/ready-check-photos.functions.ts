import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Ready Check photos for one job: office, or the boss of the job's installer business. Short-lived links, refused for anyone else. */
export const getReadyCheckPhotos = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await import("./ready-check-photos.server")).readyCheckPhotosForUser(data.jobId, context.userId));
