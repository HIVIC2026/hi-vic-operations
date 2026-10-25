import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };

/** Installer: on their own jobs the whole owner quote exactly as the owner will see it, its status and anything holding
 *  it; on our leads the status only (Jo 24 Oct). Read-only;
 *  Jo 24 Oct 2026: there is no installer approval step. */
export const getMyOwnerQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await import("./my-owner-quote.server")).myOwnerQuoteFor(context.supabase as unknown as Rpc, context.userId, data.jobId));
