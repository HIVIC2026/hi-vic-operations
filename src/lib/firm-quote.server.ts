// Internal server reader only; no endpoint, mutations or delivery.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isFirmQuoteJob } from "./firm-quote.core";
import { hasOwnerMedia } from "./photo-quote.core";

export async function firmQuoteLiveAt(): Promise<string | null> {
  const { data, error } = await admin.from("workflow_settings").select("firm_quote_flow_live_at").limit(1).maybeSingle();
  if (error) {
    const missing = error.code === "42703" || error.code === "PGRST204";
    if (missing && /firm_quote_flow_live_at/.test(error.message)) return null;
    throw new Error("Could not read firm-quote activation.");
  }
  const value = (data as unknown as { firm_quote_flow_live_at?: unknown } | null)?.firm_quote_flow_live_at;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function isFirmQuoteJobId(jobId: string): Promise<boolean> {
  const liveAt = await firmQuoteLiveAt();
  if (liveAt === null) return false;
  const { data: job, error } = await admin.from("jobs").select("source,created_at").eq("id", jobId).maybeSingle();
  if (error) throw new Error("Could not verify firm-quote job facts.");
  if (!job || !isFirmQuoteJob({ source: job.source, createdAt: job.created_at, liveAt, hasMedia: true })) return false;
  const docs = await admin.from("documents").select("kind,mime_type,storage_path").eq("job_id", jobId).eq("kind", "intake_media");
  if (docs.error) throw new Error("Could not verify owner media for firm quote.");
  return isFirmQuoteJob({ source: job.source, createdAt: job.created_at, liveAt, hasMedia: hasOwnerMedia(docs.data ?? []) });
}