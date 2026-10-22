// Preliminary email-based Save My Spot – PURE rules and rendering (Jo, 22 Oct 2026).
// For homeowners who cannot safely access the ceiling but described their home in their own email:
// an Office reviewer records an append-only preliminary review bound to the owner's genuine inbound
// communication, then Jo's approved short invitation is previewed and individually sent through the
// existing guarded delivery. This is NOT a photo review, a known R-value, a statutory eligibility
// decision or an owner declaration. No estimate, no area, no price and no rebate may appear anywhere
// in the invitation, landing page, saved confirmation or saved snapshots.
import { CUSTOMER_BRAND } from "./customer-quote-system";
import { campaignButton, escape, preheader, PRIVACY_URL, TEST_BANNER_SLOT } from "./estimate-email";
import { UNSUBSCRIBE_LINK_SLOT, withUnsubscribe } from "./emailsafety.core";
import { SPOT_SAVED_BODY, SPOT_SAVED_HEADING } from "./save-spot-offer.core";

export const PRELIMINARY_SAVE_SPOT_SUBJECT = (firstName: string | null) => `${firstName?.trim() ? firstName.trim() : "There"}, save your spot`;

/** Jo's approved short copy (22 Oct 2026). Exact wording – do not reword without Jo's approval. */
export const PRELIMINARY_INTRO = "No worries at all! Please don't worry about getting the photos.";
export const PRELIMINARY_NEXT_STEP = "Based on what you've told us, we can send you through to the next step.";
export const PRELIMINARY_BUTTON = "Save my spot";
export const PRELIMINARY_READY_CHECK = "The installer will confirm the ceiling area, existing insulation and eligibility at your free Ready Check. We'll confirm the pricing then too. There's no payment or obligation to go ahead.";
export const PRELIMINARY_SIGNOFF = "Thanks,\nJo";
export const PRELIMINARY_BRAND = "Home Insulation Victoria";

export type PreliminarySaveSpotInput = { firstName: string | null; saveUrl: string; unsubscribeUrl: string };

/** Fails closed if any priced/area/rebate content sneaks into the invitation. */
export function assertNoPricingContent(text: string) {
  if (/[$€£]|m²|\bm2\b|\brebate\b/i.test(text)) throw new Error("The preliminary invitation must never contain prices, areas or rebate figures.");
}

export function renderPreliminarySaveSpotEmail(i: PreliminarySaveSpotInput) {
  const name = i.firstName?.trim().split(/\s+/)[0]?.slice(0, 60) || null;
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const subject = PRELIMINARY_SAVE_SPOT_SUBJECT(name);
  const body = [PRELIMINARY_INTRO, PRELIMINARY_NEXT_STEP, PRELIMINARY_READY_CHECK];
  assertNoPricingContent([greeting, ...body, PRELIMINARY_SIGNOFF, PRELIMINARY_BRAND, subject].join("\n"));
  const B = CUSTOMER_BRAND.colors;
  const F = "font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif;";
  const FH = "font-family:'Outfit','Segoe UI',Helvetica,Arial,sans-serif;";
  const p = (t: string, extra = "") => `<p style="margin:0 0 14px;${F}color:${B.navy};font-size:15px;line-height:1.55;${extra}">${escape(t)}</p>`;
  const html = `<!doctype html><html lang="en-AU" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head><body lang="en-AU" style="margin:0;padding:0;background-color:${B.offWhite};">${preheader(PRELIMINARY_NEXT_STEP)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.offWhite}" style="width:100%;border-collapse:collapse;background-color:${B.offWhite};"><tr><td align="center" style="padding:20px 0 36px;"><table class="hiv-main" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${B.white}" style="width:100%;max-width:640px;border-collapse:separate;background-color:${B.white};border-radius:24px;">${TEST_BANNER_SLOT}<tr><td align="center" style="padding:26px 28px 6px;"><img src="${escape(CUSTOMER_BRAND.logoUrl)}" width="150" alt="Home Insulation Victoria" style="display:block;width:150px;max-width:150px;height:auto;border:0;"></td></tr><tr><td style="padding:14px 28px 0;"><h1 style="margin:0 0 14px;${FH}color:${B.navy};font-size:30px;line-height:36px;font-weight:800;">Save your spot</h1>${p(greeting)}${body.map((t) => p(t)).join("")}</td></tr><tr><td align="center" style="padding:6px 28px 4px;">${campaignButton(i.saveUrl, PRELIMINARY_BUTTON, 420)}</td></tr><tr><td style="padding:6px 28px 0;">${p(PRELIMINARY_SIGNOFF.replace("\n", "<br>"), "white-space:pre-line;")}</td></tr><tr><td style="padding:18px 28px 26px;border-top:1px solid #E3E8F2;"><p style="margin:0 0 6px;${F}color:${B.navy};font-size:14px;font-weight:800;text-align:center;">${escape(PRELIMINARY_BRAND)}</p><p style="margin:0;${F}color:#5A6785;font-size:12px;line-height:1.5;text-align:center;"><a href="${PRIVACY_URL}" style="color:${B.blue};text-decoration:underline;">Privacy</a>&nbsp;·&nbsp;${UNSUBSCRIBE_LINK_SLOT}</p></td></tr></table></td></tr></table></body></html>`;
  const plainText = [greeting, "", ...body.flatMap((t) => [t, ""]), `${PRELIMINARY_BUTTON}: ${i.saveUrl}`, "", PRELIMINARY_SIGNOFF, PRELIMINARY_BRAND, "", `Privacy: ${PRIVACY_URL}`].join("\n");
  return withUnsubscribe({ subject, html, plainText }, i.unsubscribeUrl);
}

/** Rebate-free saved confirmation for this path. Approved wording only; never a "$0 rebate is waiting" line. */
export function renderPreliminarySpotSavedEmail(i: { firstName: string | null; myJobUrl: string | null }) {
  const name = i.firstName?.trim() || null;
  const subject = "Your spot is saved";
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const link = i.myJobUrl ? [``, `See my job: ${i.myJobUrl}`] : [];
  const text = [greeting, "", SPOT_SAVED_HEADING + ".", SPOT_SAVED_BODY, ...link, "", PRELIMINARY_BRAND].join("\n");
  const linkHtml = i.myJobUrl ? `<p><a href="${escape(i.myJobUrl)}">See my job</a></p>` : "";
  const html = `<div style="font-family:'Figtree','Segoe UI',Helvetica,Arial,sans-serif;color:${CUSTOMER_BRAND.colors.navy};font-size:15px;line-height:1.6;"><p>${escape(greeting)}</p><h1 style="font-size:24px;">${escape(SPOT_SAVED_HEADING)}</h1><p>${escape(SPOT_SAVED_BODY)}</p>${linkHtml}<p>${escape(PRELIMINARY_BRAND)}</p></div>`;
  return { subject, html, text };
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
