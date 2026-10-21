import { stageWording } from "./job-wording";
// Plain-words "what do I do next" for a trade's job list. Presentation only — never moves a job.

export type TradeTaskInput = { stage: string; bookings: { kind: string; scheduled_start: string }[]; blockers: string[]; proposalPending?: boolean; trade?: "installer" | "electrician" };
export type TradeTask = { bucket: "needs_you" | "coming_up" | "waiting"; label: string; reason: string | null };

const NEEDS: Record<string, string> = {
  ready_check_ready_to_schedule: "Book the Ready Check with the owner",
  ready_check_scheduled: "Do the Ready Check and fill in the form",
  piesa_scheduled: "Do the PIESA and fill in the form",
  assessment_booking: "Book the PIESA with the owner",
  rectification_scheduling: "Book the electrical fixes with the owner",
  rectification_booked: "Do the electrical fixes and sign them off",
  installation_scheduling: "Book the install with the owner",
  installation_booked: "Install and add the photos",
  evidence_outstanding: "Add the missing install photos",
};
const WAITING: Record<string, string> = Object.fromEntries(["ready_check_complete", "measured_estimate_ready", "awaiting_quote_acceptance", "measured_quote_accepted", "awaiting_deposit_payment", "piesa_and_install_window_pending", "piesa_complete", "rectification_required", "awaiting_owner_rectification_approval", "ap_review", "ready_for_veec"].map((k) => [k, stageWording(k).trade ?? stageWording(k).tag]));

const ELECTRICIAN_STAGES = new Set(["assessment_booking", "piesa_scheduled", "rectification_scheduling", "rectification_booked"]);

export function tradeTask(j: TradeTaskInput): TradeTask {
  // An electrician's own steps are the safety check and fix-up work; install steps belong to the installer.
  if (j.trade === "electrician" && NEEDS[j.stage] && !ELECTRICIAN_STAGES.has(j.stage)) return { bucket: "waiting", label: "Waiting for the installer", reason: null };
  if (j.trade === "installer" && ELECTRICIAN_STAGES.has(j.stage)) return { bucket: "waiting", label: "Waiting for the electrician", reason: null };
  const booked = j.bookings[0];
  const reason = j.blockers[0] ?? null;
  const visitStage = ["ready_check_scheduled", "piesa_scheduled", "rectification_booked", "installation_booked"].includes(j.stage);
  if (visitStage && booked && new Date(booked.scheduled_start).getTime() > Date.now() - 12 * 3_600_000) return { bucket: "coming_up", label: NEEDS[j.stage]!, reason: null };
  if (NEEDS[j.stage]) return { bucket: "needs_you", label: j.proposalPending ? "Reply to the owner's suggested time" : NEEDS[j.stage]!, reason };
  return { bucket: "waiting", label: WAITING[j.stage] ?? "Waiting on Home Insulation Victoria", reason: null };
}

/**
 * Job-page headline for the SIGNED-IN trade only: "Your turn" only when the next action is that trade's own;
 * another trade's step reads "Waiting on …". Unknown role (still loading) is never "Your turn".
 */
export function tradeTurn(x: { trade: "installer" | "electrician" | null | undefined; stage: string; waitingOn: string | null | undefined }): { yourTurn: boolean; eyebrow: string; task: TradeTask } {
  const trade = x.trade === "installer" || x.trade === "electrician" ? x.trade : null;
  const task = tradeTask({ stage: x.stage, bookings: [], blockers: [], ...(trade ? { trade } : {}) });
  const mine = trade === "installer" ? "Installer" : trade === "electrician" ? "Electrician" : null;
  const other = trade === "installer" ? "Electrician" : trade === "electrician" ? "Installer" : null;
  const otherStep = (other && x.waitingOn === other) || task.label.startsWith("Waiting for the");
  const yourTurn = !!trade && !otherStep && (x.waitingOn === mine || task.bucket !== "waiting");
  const eyebrow = yourTurn ? "Your turn" : otherStep && other ? `Waiting for the ${other.toLowerCase()}` : `Waiting on ${x.waitingOn ?? "Home Insulation Victoria"}`;
  return { yourTurn, eyebrow, task };
}
