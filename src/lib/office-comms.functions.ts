// O7 Communications (decisions 16, 159, 165, 248). Admin-only. Reads + cancel held/queued; NO send and NO retry here.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./workflow.server";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const getHeldAndQueued = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-comms.server")).heldAndQueued());
  });

/** "Cancel these" (one message type) or "Cancel all held". Keys come from the list the office is looking at. */
export const cancelHeldMessages = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ keys: z.array(z.string().max(60)).min(1).max(5000), scope: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ context, data }) => {
    await requireAdmin(context.supabase);
    return (await import("./office-comms.server")).cancelHeld(data.keys, context.userId, data.scope);
  });

export const getSentMessages = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-comms.server")).recentlySent());
  });

export const getFailedMessages = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-comms.server")).failedMessages());
  });

export const getOutlookMail = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    return plain(await (await import("./office-comms.server")).outlookMail());
  });
