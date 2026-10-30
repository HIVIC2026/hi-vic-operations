// "Pause all trade messages" (Jo 30 Oct 2026): the one read of `workflow_settings.trade_messages_paused`, once per send.
// Rules in trade-pause.core.ts. Missing column (SQL not live) = NOT paused + a warning; any other read failure holds.
// Never sends; safe to import from sender modules only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { readTradePause } from "./trade-pause.core";

/** The hold reason while trade messages are paused, else null. */
export async function tradeMessagesPausedNow(): Promise<string | null> {
  let r: { data: unknown; error: { code?: string | null; message?: string | null } | null };
  try {
    r = await (admin as any).from("workflow_settings").select("trade_messages_paused").eq("id", 1).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch (e) {
    r = { data: null, error: { message: (e as Error).message } };
  }
  const out = readTradePause({ data: r.data as { trade_messages_paused?: boolean | null } | null, error: r.error });
  if (out.warning) console.warn(out.warning);
  return out.reason;
}
