// Office "Owner emails to review": latest owner email per job with no reply/decision after it. Read-only except "Done".
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { emailNeedsOffice, emailOwnerMedia, canUseReviewButtons, type EmailAttachment } from "./owner-email-review.core";
import { emailPreview, emailSuburb, isHumanOwnerEmail, latestPerOwner } from "./owner-email-presentation.core";

const SINCE = "2026-10-19T13:00:00Z"; // 20 Oct 2026, Melbourne — the copier's live window for this list

/** Signed links to owner photos/videos attached to their emails (private storage). */
export async function ownerEmailMediaFiles(jobId: string) {
  const { data, error } = await admin.from("job_communications").select("id, received_at, attachment_refs")
    .eq("job_id", jobId).eq("provider", "outlook").eq("direction", "inbound");
  if (error) throw new Error(`Email attachments unavailable: ${error.message}`);
  const files: { id: string; mimeType: string | null; url: string; at: string | null }[] = [];
  for (const c of data ?? []) for (const a of emailOwnerMedia((c.attachment_refs ?? []) as (EmailAttachment & { id?: string })[])) {
    if (!a.path) continue;
    const s = await admin.storage.from("job-files").createSignedUrl(a.path, 3600);
    if (s.data) files.push({ id: `${c.id}:${a.id ?? a.path}`, mimeType: a.contentType ?? null, url: s.data.signedUrl, at: c.received_at });
  }
  return files;
}
