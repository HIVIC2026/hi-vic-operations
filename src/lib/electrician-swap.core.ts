// Part 2 (Jo 3 Nov 2026): the installer changes the electrician on its own job until the safety check (PIESA) is done.
// Pure rules and wording only; the swap itself is electrician-swap.server.ts.
import { esc, genericMail } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";

export const SWAP_PIESA_DONE = "The safety check is done, so the electrician can't change";
export const SWAP_NOT_LINKED = "That electrician isn't linked to your business";
export const SWAP_NOT_ONBOARDED = "That electrician hasn't finished signing up";
export const SWAP_SAME = "That's already the electrician";

export const OWN_JOB_ELECTRICIAN_SWAPPED_EVENT = "own_job_electrician_swapped";
export const OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT = "own_job_swap_form_not_moved";

/** Why this swap can't go ahead (null = fine). The first reason that applies wins. */
export function swapProblem(f: { piesaDone: boolean; linkedActive: boolean; onboarded: boolean; same: boolean }): string | null {
  if (f.piesaDone) return SWAP_PIESA_DONE;
  if (!f.linkedActive) return SWAP_NOT_LINKED;
  if (!f.onboarded) return SWAP_NOT_ONBOARDED;
  if (f.same) return SWAP_SAME;
  return null;
}

/** Jo approved the "You're no longer on this job" email to the old electrician on 3 Nov 2026. */
export const OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED: boolean = true;

/** The old electrician: they're off this job. */
export function oldElectricianEmail(i: { address: string }): { subject: string; text: string } {
  return { subject: `You're no longer on ${i.address}`, text: `The installer has picked another electrician for the safety check (PIESA) at ${i.address}. You don't need to do anything. Your link no longer works.` };
}

/** The old electrician is emailed once per ended assignment. */
export const oldElectricianEmailKey = (assignmentId: string) => `electrician-swap:v1:${assignmentId}:old-electrician`;

/** Jo approved the owner email for a swap that cancels a booked safety check on 3 Nov 2026 (message 7). */
export const OWN_JOB_SWAP_OWNER_EMAIL_APPROVED: boolean = true;
export const OWN_JOB_SWAP_OWNER_PURPOSE = "own_job_swap_booking_cancelled";

/** The owner is emailed once per cancelled (confirmed) booking. */
export const ownerSwapEmailKey = (bookingId: string) => `electrician-swap:v1:${bookingId}:owner-booking-cancelled`;

/** Message 7 (wording approved by Jo 3 Nov 2026, exactly as written in docs/wording/2026-11-03-part2-messages.md). */
export function ownerSwapCancelledEmail(i: { firstName: string | null; address: string; unsubscribeUrl?: string | null; test?: boolean }): { subject: string; text: string; html: string } {
  const subject = "Your safety check needs a new time";
  const paragraphs = [
    `Hi ${i.firstName?.trim() || "there"},`,
    `Your installer has changed the electrician for your safety check (PIESA) at ${i.address}, so the time we booked is cancelled.`,
    "Your new electrician will call you soon to book a new time. You don't need to do anything.",
    "Cheers,\nthe Home Insulation Victoria team",
  ];
  const html = genericMail({ subject, bodyHtml: paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br />")}</p>`).join(""), unsubscribe: i.unsubscribeUrl ?? null, testLabel: i.test === true });
  return { subject, text: plainText(paragraphs.flatMap((p) => [p, ""]).slice(0, -1), { unsubscribe: i.unsubscribeUrl ?? null, testLabel: i.test === true }), html };
}
