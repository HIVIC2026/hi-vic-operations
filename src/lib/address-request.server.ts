// Reads the facts behind "is this enquiry waiting for the owner's full address?". Read-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDRESS_REQUEST_ANSWERED_EVENT, ADDRESS_REQUEST_REMINDER_EVENT, ADDRESS_REQUEST_SENT_EVENT, type AddressRequestFacts } from "./address-request.core";

const loose = admin as unknown as SupabaseClient;

/** null = switched off (column missing, unreadable or empty). */
async function readGoLiveAt(): Promise<string | null> {
  const { data, error } = await loose.from("workflow_settings").select("address_request_live_at").eq("id", 1).maybeSingle();
  const v = error || !data ? null : (data as Record<string, unknown>)["address_request_live_at"];
  return typeof v === "string" && v ? v : null;
}

async function firstEventAt(jobId: string, type: string): Promise<string | null> {
  const { data } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", type).order("created_at", { ascending: true }).limit(1);
  return data?.[0]?.created_at ?? null;
}

export async function loadAddressRequestFacts(jobId: string): Promise<AddressRequestFacts | null> {
  const { data: job, error } = await admin.from("jobs").select("source, channel, created_at, properties(address_line)").eq("id", jobId).maybeSingle();
  if (error || !job) return null;
  const [goLiveAt, sentAt, reminderAt, answeredAt] = await Promise.all([
    readGoLiveAt(),
    firstEventAt(jobId, ADDRESS_REQUEST_SENT_EVENT),
    firstEventAt(jobId, ADDRESS_REQUEST_REMINDER_EVENT),
    firstEventAt(jobId, ADDRESS_REQUEST_ANSWERED_EVENT),
  ]);
  const property = job.properties as unknown as { address_line: string | null } | null;
  return { addressLine: property?.address_line ?? null, source: job.source ?? null, channel: job.channel ?? null, createdAt: job.created_at, goLiveAt, sentAt, reminderAt, answeredAt };
}
