// Decision 363 (Jo 25 Oct 2026): a manufacturer warranty PDF that was not on file when the All done email / completion
// pack went out is sent to the owner on its own once it is added, so the owner holds it and the AP auto-signature
// (decision 271) can proceed. ONE email per job (O73 "Your insulation warranty", PDF attached), key
// `warranty-followup:v1:{job}`, then `warranty_copy_provided` is recorded with via "warranty_followup".
// Wording is a DRAFT (docs/templates/drafts/O73-warranty-followup.html, rendered by scripts/render-decision-363-drafts.ts):
// WARRANTY_FOLLOWUP_APPROVED stays false until Jo approves it — real owners get nothing and nothing is recorded while it is
// false; TEST (qa_test) jobs use test-send. PURE: rules, key and the renderer. No I/O.
import * as K from "./email-kit.core";

export const WARRANTY_FOLLOWUP_APPROVED = false as boolean;
export const WARRANTY_FOLLOWUP_TEMPLATE_CODE = "O73";
export const WARRANTY_FOLLOWUP_PURPOSE = "warranty_followup";
/** Recorded once per job BEFORE the email is sent (so a tick never sends twice). */
export const WARRANTY_FOLLOWUP_SENT_EVENT = "warranty_followup_sent";
/** Recorded by the completion pack when an installed product's warranty PDF was not on file. */
export const PRODUCT_WARRANTY_MISSING_EVENT = "product_warranty_missing";
export const warrantyFollowupKey = (jobId: string) => `warranty-followup:v1:${jobId}`;

export type WarrantyFollowupFacts = {
  installCompleted: boolean; deleted: boolean;
  /** A `product_warranty_missing` event exists (the pack went out without a PDF). */
  missingRecorded: boolean;
  /** `warranty_copy_provided` already recorded (by O44, O47 or an earlier follow-up). */
  provided: boolean;
  /** A follow-up was already sent for this job (key used). */
  alreadySent: boolean;
  /** Installed products, and whether every one now has its PDF on file. */
  products: string[]; allOnFile: boolean;
};

/** Why nothing happens now, or null when the follow-up email is due. */
export function warrantyFollowupBlocker(f: WarrantyFollowupFacts): string | null {
  if (f.deleted) return "job deleted";
  if (!f.installCompleted) return "install not recorded complete";
  if (!f.missingRecorded) return "no warranty was missing";
  if (f.provided) return "warranty copy already provided";
  if (f.alreadySent) return "follow-up already sent";
  if (!f.products.length) return "installed product not known";
  if (!f.allOnFile) return "warranty PDF still not on file";
  return null;
}

export type WarrantyFollowupEmailInput = { firstName: string | null; products: string[]; unsubscribeUrl: string | null; test?: boolean };

/** O73 DRAFT wording (not approved): subject "Your insulation warranty", three plain sentences, the PDF attached. */
export function warrantyFollowupCopy(products: string[]): { subject: string; lines: string[] } {
  const named = products.length ? `the ${products.join(" and ")} insulation` : "the insulation";
  return {
    subject: "Your insulation warranty",
    lines: [
      `Attached is the manufacturer's warranty for ${named} we installed in your ceiling.`,
      "We couldn't include it with your earlier email, so please keep this copy with your other job papers.",
      "If you have any questions, just reply to this email.",
    ],
  };
}

export function renderWarrantyFollowupEmail(i: WarrantyFollowupEmailInput): { subject: string; html: string; text: string } {
  const first = K.cleanName(i.firstName) ?? "there";
  const c = warrantyFollowupCopy(i.products);
  const html = K.emailShell({ body: [K.h1(c.subject, 8), K.greeting(`Hi ${first},`), ...c.lines.map((l, n) => K.p(l, n === c.lines.length - 1 ? "0 0 4px" : "0 0 14px"))].join("\n"), previewText: null, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([c.subject, "", `Hi ${first},`, "", c.lines.join("\n\n")], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: c.subject, html, text };
}
