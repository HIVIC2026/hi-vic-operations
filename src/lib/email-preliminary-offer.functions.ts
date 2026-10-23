import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";
import { withRequestMeta } from "./request-meta";

const uuid = z.string().uuid();
const token = z.string().max(200);

/** Owner landing read on the secure link. Read-only; the link token is the capability. */
export const getPreliminarySavePageFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./email-preliminary-offer.server")).preliminarySavePage(data.token));

/** Owner's explicit POST on the secure link. Saves once; never a made-up area, price or rebate. */
export const savePreliminarySpotFn = createServerFn({ method: "POST" }).middleware([withRequestMeta])
  .inputValidator((d: unknown) => z.object({ token }).parse(d))
  .handler(async ({ data }) => (await import("./email-preliminary-offer.server")).savePreliminarySpot(data.token));
