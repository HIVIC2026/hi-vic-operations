// Pure rules for owner emails (copied from info@) that need an office review or reply (Jo, 23 Oct 2026).
export type EmailAttachment = { name?: string | null; contentType?: string | null; isInline?: boolean | null; path?: string | null; skipped?: string | null };
export type JobEmailFacts = {
  latestInboundAt: string;
  laterOutboundAt: string | null; // latest outbound email/text on the job after the inbound one
  laterReviewAt: string | null; // latest office photo review / review-button decision after it
  doneAt: string | null; // office marked the email done
};

/** Owner photos/videos in an email: real image/video attachments only (never inline signature logos). */
export function emailOwnerMedia<T extends EmailAttachment>(refs: T[] | null | undefined): T[] {
  return (refs ?? []).filter((a) => !a.isInline && /^(image|video)\//i.test(a.contentType ?? "") || (!a.isInline && /\.(jpe?g|png|heic|heif|webp|mov|mp4|webm)$/i.test(a.name ?? "")));
}

/** Still needs the office: no reply, review decision or "done" after the owner's latest email. */
export function emailNeedsOffice(f: JobEmailFacts): boolean {
  const at = Date.parse(f.latestInboundAt);
  if (!Number.isFinite(at)) return false;
  return ![f.laterOutboundAt, f.laterReviewAt, f.doneAt].some((t) => t != null && Date.parse(t) >= at);
}

/** The three review buttons only work on pre-progression enquiries. */
export const REVIEWABLE_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "on_hold"] as const;
export const canUseReviewButtons = (stage: string) => (REVIEWABLE_STAGES as readonly string[]).includes(stage);
