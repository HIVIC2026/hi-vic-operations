// ONE wording list for every screen (Jo-approved Step 3 list, 21 Oct 2026). Words only: never decides stage,
// classification, eligibility or who a job waits on. Older label maps are thin wrappers around this file.
import type { Stage } from "./workflow";

export const WHO_WAITING_US = "Home Insulation Victoria" as const;
export const PIESA_FULL = "Pre Insulation Electrical Safety Assessment (PIESA)";

export type Wording = { tag: string; next: string; owner?: string; trade?: string };

const W = {
  new_enquiry: { tag: "New enquiry", next: "Check eligibility", owner: "We've received your enquiry" },
  eligibility_review: { tag: "Checking eligibility", next: "Confirm eligibility", owner: "We're checking your eligibility" },
  preliminary_estimate_ready: { tag: "Estimate sent", next: "Wait for owner to save their spot", owner: "Your estimate is ready – Save my spot" },
  spot_saved: { tag: "Spot saved", next: "Book Ready Check", owner: "Spot saved – we'll be in touch to book your free Ready Check", trade: "Ready Check to be booked" },
  ready_check_awaiting_acceptance: { tag: "Ready Check offered", next: "Wait for owner to accept Ready Check", owner: "Accept your free Ready Check" },
  ready_check_scheduled: { tag: "Ready Check booked", next: "Installer to do Ready Check", owner: "Your Ready Check is booked", trade: "Ready Check booked" },
  ready_check_complete: { tag: "Ready Check done", next: "Confirm eligibility and send quote", owner: "Ready Check done – your quote is being prepared", trade: "Ready Check done – being checked by Home Insulation Victoria" },
  measured_estimate_ready: { tag: "Quote sent", next: "Wait for owner to accept quote", owner: "Your quote is ready – review and accept", trade: "Quote waiting for owner" },
  measured_quote_accepted: { tag: "Quote accepted", next: "Wait for owner's payment", owner: "Quote accepted – complete your payment", trade: "Quote accepted – waiting for owner's payment" },
  piesa_and_install_window_pending: { tag: "PIESA to book", next: "Book PIESA and install dates", owner: `Choose times for your ${PIESA_FULL}`, trade: "PIESA to be booked" },
  piesa_scheduled: { tag: "PIESA booked", next: "Electrician to do PIESA", owner: `Your ${PIESA_FULL} is booked`, trade: "PIESA booked" },
  piesa_complete: { tag: "PIESA done", next: "Check PIESA result", owner: `${PIESA_FULL} done – we're checking the result`, trade: "PIESA done – being checked by Home Insulation Victoria" },
  electrical_variation_pending: { tag: "Electrical fixes to approve", next: "Wait for owner to approve electrical fixes", owner: "Review and approve your electrical fixes", trade: "Electrical fixes waiting for owner" },
  rectification_required: { tag: "Electrical fixes needed", next: "Send electrical fixes quote", owner: "Electrical fixes are needed – your quote is on its way", trade: "Electrical fixes needed" },
  awaiting_owner_rectification_approval: { tag: "Electrical fixes quote sent", next: "Wait for owner to approve electrical fixes quote", owner: "Review and approve your electrical fixes quote", trade: "Electrical fixes quote waiting for owner" },
  awaiting_deposit_payment: { tag: "Waiting for payment", next: "Wait for owner's payment", owner: "Complete your payment", trade: "Waiting for owner's payment" },
  rectification_scheduling: { tag: "Electrical fixes to book", next: "Book electrical fixes", owner: "Choose a time for your electrical fixes", trade: "Electrical fixes to be booked" },
  rectification_booked: { tag: "Electrical fixes booked", next: "Electrician to do electrical fixes", owner: "Your electrical fixes are booked", trade: "Electrical fixes booked" },
  installation_scheduling: { tag: "Install to book", next: "Book install date", owner: "Choose your install date", trade: "Install date to be agreed" },
  installation_booked: { tag: "Install booked", next: "Installer to do install", owner: "Your install is booked", trade: "Install booked" },
  evidence_outstanding: { tag: "Photos missing", next: "Installer to upload photos and PIISA", owner: "Install done – we're finishing the paperwork", trade: "Upload missing photos and PIISA" },
  ap_review: { tag: "Final check", next: "Do final check", owner: "Install done – we're finishing the paperwork", trade: "Being checked by Home Insulation Victoria" },
  ready_for_veec: { tag: "Ready to lodge", next: "Lodge VEECs", owner: "Install done – we're finishing the paperwork", trade: "Being checked by Home Insulation Victoria" },
  complete: { tag: "Complete", next: "No action", owner: "All done", trade: "Complete" },
  on_hold: { tag: "On hold", next: "Sort out hold", owner: "Your job is on hold – we'll be in touch", trade: "On hold" },
  cancelled: { tag: "Cancelled", next: "No action", owner: "Cancelled", trade: "Cancelled" },
} satisfies Record<string, Wording>;
export type WordingKey = keyof typeof W;

/** Older/retired stages show exactly the same words as their newer equivalent (Jo, 21 Oct). */
const ALIAS: Partial<Record<Stage, WordingKey>> = {
  ready_check_ready_to_schedule: "spot_saved",
  ready_check_awaiting_payment: "spot_saved",
  awaiting_electrician: "piesa_and_install_window_pending",
  assessment_booking: "piesa_and_install_window_pending",
  assessment_booked: "piesa_scheduled",
  assessment_complete: "piesa_complete",
  ready_for_installer_quotes: "ready_check_complete",
  awaiting_quote_acceptance: "measured_estimate_ready",
};

export function stageWording(stage: string | null | undefined, opts: { spotSaved?: boolean } = {}): Wording {
  const s = (stage ?? "new_enquiry") as Stage;
  if (s === "preliminary_estimate_ready" && opts.spotSaved) return W.spot_saved;
  const key = (ALIAS[s] ?? s) as WordingKey;
  return W[key] ?? { tag: String(stage), next: "Check job records" };
}
export const stageTag = (s: string | null | undefined) => stageWording(s).tag;
export const stageNext = (s: string | null | undefined) => stageWording(s).next;

/** Record-based situations (office classifier keys). Words only; classification lives in office-status.core. */
export const SITUATION: Record<string, { tag: string; next?: string }> = {
  "waiting_list.ready_to_send": { tag: "Estimate ready", next: "Send estimate" },
  "waiting_list.needs_estimate": { tag: "Needs estimate", next: "Prepare estimate" },
  "enquiry.checking": { tag: "Checking eligibility" },
  "enquiry.estimate_sent": { tag: "Estimate sent", next: "Remind owner" },
  "enquiry.video_asked": { tag: "Photos asked for", next: "Remind owner" },
  "enquiry.video_in": { tag: "Photos to check", next: "Check photos" },
  "enquiry.spot_saved": { tag: "Spot saved", next: "Book Ready Check" },
  "enquiry.spot_saved_video": { tag: "Spot saved", next: "Book Ready Check" },
  "enquiry.spot_saved_waiting": { tag: "Waiting – Ready Checks not open yet" },
  "ready_check.pick_times": { tag: "Owner picking times", next: "Remind owner" },
  "ready_check.offered": { tag: "Offered to installers", next: "Offer to more installers" },
  "ready_check.booked": { tag: "Ready Check booked" },
  "ready_check.onsite_started": { tag: "Ready Check started", next: "Installer to finish Ready Check" },
  "ready_check.arranging": { tag: "Arranging Ready Check", next: "Remind installer" },
  "ready_check.done": { tag: "Ready Check done" },
  "ready_check.evidence_in": { tag: "Ready Check photos to check", next: "Confirm eligibility" },
  "quote.sent_auto": { tag: "Quote sent" },
  "quote.held": { tag: "Quote held", next: "Review quote" },
  "quote.waiting_sign": { tag: "Quote sent", next: "Remind owner" },
  "quote.waiting_payment": { tag: "Quote accepted", next: "Remind owner" },
  "quote.paid": { tag: "PIESA to book" },
  "safety.pick_times": { tag: "Owner picking PIESA times", next: "Remind owner" },
  "safety.offered": { tag: "Offered to electricians", next: "Offer to more electricians" },
  "safety.booked": { tag: "PIESA booked" },
  "safety.arranging": { tag: "Arranging PIESA", next: "Remind electrician" },
  "safety.passed": { tag: "PIESA passed", next: "Book install within 30 days" },
  "safety.fix_sent_auto": { tag: "Electrical fixes quote sent" },
  "safety.fix_held": { tag: "Electrical fixes to price", next: "Price the item" },
  "safety.fix_approve": { tag: "Electrical fixes to approve", next: "Remind owner" },
  "safety.fixes_booked": { tag: "Electrical fixes booked" },
  "safety.fixed": { tag: "Electrical fixes done", next: "Book install" },
  "install.agree": { tag: "Agreeing install date", next: "Remind installer" },
  "install.booked": { tag: "Install booked" },
  "install.checking": { tag: "Checking install photos", next: "Check photos" },
  "install.evidence_missing": { tag: "Photos missing", next: "Installer to upload photos and PIISA" },
  "signoff.ap": { tag: "Final check", next: "Do final check" },
  "signoff.veec_waiting": { tag: "VEECs lodged", next: "Wait for registration" },
  "signoff.payouts_due": { tag: "Payout due", next: "Mark paid" },
  "ended.complete": { tag: "Complete" },
  "ended.cancelled": { tag: "Cancelled" },
  "ended.on_hold": { tag: "On hold", next: "Sort out hold" },
};

export const ELIGIBILITY_WORDS = { likely_eligible: "Likely eligible", needs_onsite_confirmation: "Check onsite", does_not_appear_eligible: "Not eligible", review: "Needs review" } as const;
export const MISMATCH_WORDS = { tag: "Stage mismatch", next: "Check job records" } as const;

/** Display words for the operations classifier's internal process keys (keys themselves stay unchanged). */
const PROCESS_WORDS: Record<string, string> = {
  "Eligibility & estimate": "Checking eligibility", "Insulation review": "Photos to check", "Offer & owner response": "Estimate sent",
  "Spot saved — waiting for availability": "Spot saved", "Ineligible enquiry": "Not eligible", "Electrical safety & fixes": "PIESA and electrical fixes",
  "Installation": "Install", "Evidence & AP review": "Final check", "VEEC lodgement": "Ready to lodge", "Completed": "Complete", "Needs classification": "Stage mismatch",
};
export const processWords = (p: string) => PROCESS_WORDS[p] ?? p;
export const partyWords = (p: string) => (p === "Homeowner" ? "Owner" : p === "Office" ? WHO_WAITING_US : p);
