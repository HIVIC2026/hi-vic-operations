import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

/** All acceptance/payment readers must use the newest non-superseded revision, not the newest accepted one. */
export async function currentFixesQuote(jobId: string) {
  const { data, error } = await admin.from("quotes").select("id, status, version, customer_total_inc_gst, accepted_at, created_at").eq("job_id", jobId).eq("kind", "rectification").neq("status", "superseded").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("The newest electrical fixes quote could not be checked.");
  return data;
}

export const FIXES_ACCEPT_LATEST = "The owner must accept the newest electrical fixes quote before the fixes can be booked.";