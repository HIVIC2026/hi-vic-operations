// Office "Owner emails to review": latest owner email per job with no reply/decision after it. Read-only except "Done".
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { emailNeedsOffice, emailOwnerMedia, canUseReviewButtons, type EmailAttachment } from "./owner-email-review.core";

const SINCE = "2026-10-19T13:00:00Z"; // 20 Oct 2026, Melbourne — the copier's live window for this list

export async function listOwnerEmailsToReview() {
  const { data: inbound, error } = await admin.from("job_communications")
    .select("id, job_id, subject, body, sender_text, received_at, attachment_refs")
    .eq("provider", "outlook").eq("direction", "inbound").gte("received_at", SINCE)
    .order("received_at", { ascending: false }).limit(1000);
  if (error) throw new Error(`Owner emails unavailable: ${error.message}`);
  const latest = new Map<string, NonNullable<typeof inbound>[number]>();
  for (const c of inbound ?? []) if (!latest.has(c.job_id)) latest.set(c.job_id, c);
  const ids = [...latest.keys()];
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const [jobs, out, events, done] = await Promise.all([
      admin.from("jobs").select("id, job_number, stage, source, deleted_at, owners(full_name), properties(suburb)").in("id", batch),
      admin.from("job_communications").select("job_id, created_at, sent_at").in("job_id", batch).eq("direction", "outbound").gte("created_at", SINCE),
      admin.from("customer_engagement_events").select("job_id, occurred_at").in("job_id", batch).eq("event_type", "intake_media_reviewed").gte("occurred_at", SINCE),
      admin.from("workflow_events").select("job_id, created_at").in("job_id", batch).eq("event_type", "owner_email_reviewed").gte("created_at", SINCE),
    ]);
    for (const r of [jobs, out, events, done]) if (r.error) throw new Error(`Owner emails unavailable: ${r.error.message}`);
    const max = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
    for (const j of jobs.data ?? []) {
      if (j.deleted_at || j.source === "qa_test" || j.stage === "cancelled") continue;
      const c = latest.get(j.id)!;
      const needs = emailNeedsOffice({
        latestInboundAt: c.received_at!,
        laterOutboundAt: max((out.data ?? []).filter((o) => o.job_id === j.id).map((o) => o.sent_at ?? o.created_at)),
        laterReviewAt: max((events.data ?? []).filter((e) => e.job_id === j.id).map((e) => e.occurred_at)),
        doneAt: max((done.data ?? []).filter((e) => e.job_id === j.id).map((e) => e.created_at)),
      });
      if (!needs) continue;
      const owner = (Array.isArray(j.owners) ? j.owners[0] : j.owners) as { full_name: string | null } | null;
      const prop = (Array.isArray(j.properties) ? j.properties[0] : j.properties) as { suburb: string | null } | null;
      rows.push({
        jobId: j.id, jobNumber: j.job_number, owner: owner?.full_name ?? null, suburb: prop?.suburb ?? null, stage: j.stage,
        canReview: canUseReviewButtons(j.stage), from: c.sender_text, subject: c.subject, body: (c.body ?? "").slice(0, 1200), at: c.received_at,
        mediaCount: emailOwnerMedia((c.attachment_refs ?? []) as EmailAttachment[]).filter((a) => a.path).length,
      });
    }
  }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const { count, error: ue } = await admin.from("correspondence_reviews").select("id", { count: "exact", head: true })
    .eq("provider", "outlook").eq("kind", "unmatched").eq("direction", "inbound").eq("status", "open");
  if (ue) throw new Error(`Unmatched emails unavailable: ${ue.message}`);
  return { rows, unmatched: count ?? 0 };
}

/** Office marks an owner email handled without a reply (permanent history entry). */
export async function markOwnerEmailReviewed(jobId: string, by: string | null) {
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, by, "owner_email_reviewed", "Owner email reviewed by office", {}, { internal: true });
  return { ok: true as const };
}

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
