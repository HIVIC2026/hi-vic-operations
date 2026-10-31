// "Pause all trade messages" (Jo 30 Oct 2026): the one read of `workflow_settings.trade_messages_paused`, once per send.
// Rules in trade-pause.core.ts. Missing column (SQL not live) = NOT paused + a warning; any other read failure holds.
// Never sends; safe to import from sender modules only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { businessPauseException, readTradePause } from "./trade-pause.core";

let missingWarned = false;

/** The hold reason while trade messages are paused, else null. */
export async function tradeMessagesPausedNow(opts?: { businessId?: string | null }): Promise<string | null> {
  let r: { data: unknown; error: { code?: string | null; message?: string | null } | null };
  try {
    r = await (admin as any).from("workflow_settings").select("trade_messages_paused").eq("id", 1).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch (e) {
    r = { data: null, error: { message: (e as Error).message } };
  }
  const out = readTradePause({ data: r.data as { trade_messages_paused?: boolean | null } | null, error: r.error });
  // The missing-column warning is logged once per process (it would repeat on every send); real read failures every time.
  if (out.warning && (out.reason !== null || !missingWarned)) { if (out.reason === null) missingWarned = true; console.warn(out.warning); }
  if (!out.reason || !opts?.businessId) return out.reason;
  // Per-business exception (Jo 31 Oct): any read failure or missing column keeps the hold.
  try {
    const b = await (admin as any).from("businesses").select("messages_while_paused").eq("id", opts.businessId).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (b.error) return out.reason;
    return businessPauseException(out.reason, (b.data as { messages_while_paused?: boolean | null } | null)?.messages_while_paused);
  } catch { return out.reason; }
}
