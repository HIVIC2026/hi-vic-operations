// Preliminary email-based Save My Spot – PURE rules (Jo, 22 Oct 2026). The invitation email itself was retired
// by Jo on 23 Oct 2026 and its renderer removed on 24 Oct; the save page for links already sent stays live.
// For homeowners who cannot safely access the ceiling but described their home in their own email:
// an Office reviewer records an append-only preliminary review bound to the owner's genuine inbound
// communication, then Jo's approved short invitation is previewed and individually sent through the
// existing guarded delivery. This is NOT a photo review, a known R-value, a statutory eligibility
// decision or an owner declaration. Invitation wording stays unchanged; saved confirmations and
// snapshots use the owner's normal address/ceiling-size estimate (Jo, 23 Oct 2026).
import { savedPriceFromEstimate } from "./launch-campaign.core";

/** Jo's approved short copy (22 Oct 2026), still shown on the save page. Exact wording – do not reword without Jo's approval. */
export const PRELIMINARY_INTRO = "No worries at all! Please don't worry about getting the photos.";
export const PRELIMINARY_NEXT_STEP = "Based on what you've told us, we can send you through to the next step.";
export const PRELIMINARY_BUTTON = "Save my spot";
export const PRELIMINARY_READY_CHECK = "The installer will confirm the ceiling area, existing insulation and eligibility at your free Ready Check. We'll confirm the pricing then too. There's no payment or obligation to go ahead.";
export const PRELIMINARY_BRAND = "Home Insulation Victoria";

/** Same primary-scenario figures saved by the normal campaign; never fabricate missing figures. */
export function preliminarySavedEstimateSnapshot(row: Parameters<typeof savedPriceFromEstimate>[0], token: string) {
  const price = savedPriceFromEstimate(row);
  if (!price || !Number.isFinite(price.gross) || price.gross <= 0 || !Number.isFinite(price.total)
    || price.total < 0 || !Number.isFinite(price.discount) || price.discount < 0
    || price.areaM2 == null || !Number.isFinite(price.areaM2) || price.areaM2 <= 0) {
    throw new Error("Your estimate is not ready. Please contact our office before saving your spot.");
  }
  return { saved_estimate_id: price.estimateId, saved_total: price.total, saved_veu_discount: price.discount,
    saved_gross_total: price.gross, saved_area_m2: price.areaM2, saved_insulation: price.insulation,
    saved_estimate_url: `/estimate/${token}/calculator` };
}

// ---------- Pending-review / consent binding facts (pure) ----------
export const EMAIL_PRELIMINARY_REVIEW_EVENT = "email_preliminary_review";
export const EMAIL_PRELIMINARY_CONSENT_SOURCE = "owner_email_reply_request";
export const PRELIMINARY_LINK_PURPOSE = "preliminary_save_spot";
export const PRELIMINARY_SEND_PURPOSE = "email_preliminary_save_spot";
export const preliminarySendKey = (jobId: string) => `email_preliminary_save_spot:${jobId}`;
export const preliminaryConsentKey = (communicationId: string) => `email-reply:${communicationId}`;

/** Append-only review metadata. Explicitly records that this is NOT a photo/media review. */
export function preliminaryReviewMetadata(i: { reason: string; communicationId: string; emailAt: string | null; reviewer: string | null }) {
  return {
    kind: "preliminary_email_review" as const,
    photoReview: false,
    mediaReviewed: false,
    reason: i.reason.trim(),
    communication_id: i.communicationId,
    email_at: i.emailAt,
    by: i.reviewer,
  };
}

/** Immutable owner_contact_consents snapshot: individual reply permission bound to the owner's own inbound email. */
export function preliminaryConsentSnapshot(i: { communicationId: string; recordedBy: string | null; recordedAt: string }) {
  return {
    basis: "owner_contact_form_requested_reply" as const,
    purpose: "individual_reply" as const,
    communication_id: i.communicationId,
    recorded_by: i.recordedBy,
    recorded_at: i.recordedAt,
  };
}

export const PRELIMINARY_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"] as const;

/** Pure send-guard decision. Every input is a re-read fact; null = allowed. */
export function preliminarySendBlocker(x: {
  source: string | null; channel: string | null; stage: string | null;
  ownerEmail: string | null; spotSaved: boolean; optedOut: boolean;
  latestReviewId: string | null; shownReviewId: string | null; mode: "preview" | "send"; realOn: boolean;
}): string | null {
  if (x.source !== "base44" && x.source !== "portal") return "Only website or manual homeowner enquiries can use this invitation.";
  if (x.channel !== "hivic_sourced") return "Only Home Insulation Victoria-sourced enquiries can use this invitation.";
  if (!x.stage || !(PRELIMINARY_STAGES as readonly string[]).includes(x.stage)) return "This enquiry has already moved on – no invitation from here.";
  if (!x.ownerEmail?.trim()) return "No owner email.";
  if (!x.latestReviewId) return "Record the owner-email preliminary review before offering a spot.";
  if (x.mode === "send" && x.shownReviewId !== x.latestReviewId) return "Preview this invitation before sending; the recorded review must match the preview.";
  if (x.mode === "send" && !x.realOn) return "Sending is switched off.";
  if (x.spotSaved) return "Spot already saved.";
  if (x.optedOut) return "Owner opted out.";
  return null;
}
