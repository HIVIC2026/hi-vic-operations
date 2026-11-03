// "Pause all trade messages" (Jo 30 Oct 2026): the one read of `workflow_settings.trade_messages_paused`, once per send.
// Rules in trade-pause.core.ts. Missing column (SQL not live) = NOT paused + a warning; any other read failure holds.
// Never sends; safe to import from sender modules only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { pauseLiftedByAny, readTradePause } from "./trade-pause.core";

let missingWarned = false;

/** The hold reason while trade messages are paused, else null. */
export async function tradeMessagesPausedNow(opts?: { businessId?: string | null; jobId?: string | null }): Promise<string | null> {
  let r: { data: unknown; error: { code?: string | null; message?: string | null } | null };
  try {
    r = await (admin as any).from("workflow_settings").select("trade_messages_paused").eq("id", 1).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch (e) {
    r = { data: null, error: { message: (e as Error).message } };
  }
  const out = readTradePause({ data: r.data as { trade_messages_paused?: boolean | null } | null, error: r.error });
  // The missing-column warning is logged once per process (it would repeat on every send); real read failures every time.
  if (out.warning && (out.reason !== null || !missingWarned)) { if (out.reason === null) missingWarned = true; console.warn(out.warning); }
  if (!out.reason || (!opts?.businessId && !opts?.jobId)) return out.reason;
  // Per-business exception (Jo 31 Oct): a flagged business, or one related to this send (the installer an electrician
  // is linked to, the job's originating installer or active assignees), lifts the hold. Any read failure keeps it.
  try {
    const ids = new Set<string>();
    if (opts.businessId) {
      ids.add(opts.businessId);
      const pr = await (admin as any).from("partner_relationships").select("installer_business_id").eq("electrician_business_id", opts.businessId).eq("active", true); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (pr.error) return out.reason;
      for (const r of (pr.data ?? []) as { installer_business_id: string | null }[]) if (r.installer_business_id) ids.add(r.installer_business_id);
    }
    if (opts.jobId) {
      const j = await (admin as any).from("jobs").select("originating_installer_business_id").eq("id", opts.jobId).maybeSingle(); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (j.error) return out.reason;
      const orig = (j.data as { originating_installer_business_id?: string | null } | null)?.originating_installer_business_id;
      if (orig) ids.add(orig);
      const ja = await (admin as any).from("job_assignments").select("business_id").eq("job_id", opts.jobId).eq("active", true); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (ja.error) return out.reason;
      for (const r of (ja.data ?? []) as { business_id: string | null }[]) if (r.business_id) ids.add(r.business_id);
    }
    if (!ids.size) return out.reason;
    const b = await (admin as any).from("businesses").select("id, messages_while_paused").in("id", [...ids]); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (b.error) return out.reason;
    return pauseLiftedByAny(out.reason, ((b.data ?? []) as { messages_while_paused?: boolean | null }[]).map((x) => x.messages_while_paused));
  } catch { return out.reason; }
}
