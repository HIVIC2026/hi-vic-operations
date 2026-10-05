// Plain-words "what do I do next" for a trade's job list. Presentation only — never moves a job.

export type TradeTaskInput = { stage: string; bookings: { kind: string; scheduled_start: string }[]; blockers: string[]; proposalPending?: boolean };
export type TradeTask = { bucket: "needs_you" | "coming_up" | "waiting"; label: string; reason: string | null };

const NEEDS: Record<string, string> = {
  ready_check_ready_to_schedule: "Book the Ready Check with the owner",
  ready_check_scheduled: "Do the Ready Check and fill in the form",
  piesa_scheduled: "Do the safety check and fill in the form",
  assessment_booking: "Book the safety check with the owner",
  rectification_scheduling: "Book the fix-up work with the owner",
  rectification_booked: "Do the fix-up work and sign it off",
  installation_scheduling: "Book the install with the owner",
  installation_booked: "Install and add the photos",
  evidence_outstanding: "Add the missing install photos",
};
const WAITING: Record<string, string> = {
  ready_check_complete: "Office is checking your Ready Check",
  measured_estimate_ready: "Waiting for the owner to accept the quote",
  awaiting_quote_acceptance: "Waiting for the owner to accept the quote",
  measured_quote_accepted: "Waiting for the owner's payment choice",
  awaiting_deposit_payment: "Waiting for the owner's payment",
  piesa_and_install_window_pending: "Waiting for the electrical safety check",
  piesa_complete: "Office is checking the safety check",
  rectification_required: "Waiting for the fix-up quote",
  awaiting_owner_rectification_approval: "Waiting for the owner to approve the fix-up",
  ap_review: "Office is signing off the job",
  ready_for_veec: "Signed off — payment on its way",
};

export function tradeTask(j: TradeTaskInput): TradeTask {
  const booked = j.bookings[0];
  const reason = j.blockers[0] ?? null;
  const visitStage = ["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(j.stage);
  if (visitStage && booked && new Date(booked.scheduled_start).getTime() > Date.now() - 12 * 3_600_000) return { bucket: "coming_up", label: NEEDS[j.stage]!, reason: null };
  if (NEEDS[j.stage]) return { bucket: "needs_you", label: j.proposalPending ? "Reply to the owner's suggested time" : NEEDS[j.stage]!, reason };
  return { bucket: "waiting", label: WAITING[j.stage] ?? "Waiting on Home Insulation Victoria", reason: null };
}
