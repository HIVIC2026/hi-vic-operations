import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { originalEnquiryMedia } from "./group-b-media.core";

/** Fresh shared audience read for routes, send boundaries and reminders. Errors always hold. */
export async function groupBMediaForJob(jobId: string) {
  const [job, docs, evidence] = await Promise.all([
    admin.from("jobs").select("properties(enrichment)").eq("id", jobId).maybeSingle(),
    admin.from("documents").select("kind, mime_type, storage_path, source_system, external_id").eq("job_id", jobId).eq("kind", "intake_media"),
    admin.from("evidence_files").select("mime_type, storage_path").eq("job_id", jobId),
  ]);
  const property = job.data?.properties as { enrichment?: { base44?: { raw?: unknown } } } | null;
  return originalEnquiryMedia(property?.enrichment?.base44?.raw, [...(docs.data ?? []), ...(evidence.data ?? []).filter((d) => d.storage_path.startsWith(`${jobId}/intake/`)).map((d) => ({ ...d, kind: "intake_media" }))], !!job.error || !job.data || !!docs.error || !!evidence.error);
}