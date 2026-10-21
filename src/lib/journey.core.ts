// Job journey: the ordered gates and steps every job passes through, derived ONLY from the stage
// (plus the shared nextStep rule). No stored state, so it can never disagree with the pipeline.
import { DEFAULT_NEXT_ACTION, STORED_NEXT_ACTION, STAGE_LABEL, waitingOn, type Stage, type WaitingOn } from "./workflow";
import { nextStep, type NextStepInput } from "./nextstep.core";

export type GateKey = "enquiry" | "ready_check" | "quote" | "deposit" | "piesa" | "rectification" | "install" | "evidence" | "veec";
export type StepStatus = "done" | "current" | "upcoming" | "skipped";
export type GateStatus = StepStatus | "blocked";
export type JourneyStep = { stage: Stage; label: string; action: string; actor: WaitingOn; status: StepStatus; legacy: boolean };
export type JourneyGate = { key: GateKey; number: number; title: string; status: GateStatus; note: string | null; steps: JourneyStep[] };
export type Journey = {
  gates: JourneyGate[]; current: JourneyGate | null; upNext: JourneyStep[];
  headline: string; next: string; exception: "on_hold" | "cancelled" | null; mismatches: string[];
};

type GateDef = { key: GateKey; title: string; steps: Stage[]; legacy?: Stage[] };
// Order follows the live workflow. Legacy stages are only shown when a job is actually sitting in one.
export const GATES: GateDef[] = [
  { key: "enquiry", title: "Enquiry & eligibility", steps: ["new_enquiry", "eligibility_review"] },
  { key: "ready_check", title: "Ready Check / Ready Check", steps: ["preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete"], legacy: ["ready_check_awaiting_payment"] },
  { key: "quote", title: "Quote & acceptance", steps: ["measured_estimate_ready", "measured_quote_accepted"], legacy: ["ready_for_installer_quotes", "awaiting_quote_acceptance"] },
  { key: "deposit", title: "Payment", steps: ["awaiting_deposit_payment"] },
  { key: "piesa", title: "Pre Insulation Electrical Safety Assessment (PIESA)", steps: ["piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete"], legacy: ["awaiting_electrician", "assessment_booking", "assessment_booked", "assessment_complete"] },
  { key: "rectification", title: "Electrical fixes (only if needed)", steps: ["electrical_variation_pending", "rectification_required", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked"] },
  { key: "install", title: "Installation", steps: ["installation_scheduling", "installation_booked"] },
  { key: "evidence", title: "Evidence & final check", steps: ["evidence_outstanding", "ap_review"] },
  { key: "veec", title: "VEEC", steps: ["ready_for_veec", "complete"] },
];

export type JourneyInput = NextStepInput & {
  /** false = PIESA found nothing to fix; null/undefined = not known yet. */
  rectificationNeeded?: boolean | null;
  mismatches?: string[];
};

export function buildJourney(j: JourneyInput): Journey {
  const stage = (j.stage ?? "new_enquiry") as Stage;
  const ns = nextStep(j);
  const exception = stage === "on_hold" || stage === "cancelled" ? stage : null;
  const gi = GATES.findIndex((g) => g.steps.includes(stage) || g.legacy?.includes(stage));
  const blocked = ns.tone === "bad" || (j.mismatches?.length ?? 0) > 0;

  const gates: JourneyGate[] = GATES.map((g, i) => {
    const stages = [...g.steps, ...(g.legacy ?? []).filter((s) => s === stage)];
    const order = [...g.steps, ...(g.legacy ?? [])];
    const cur = order.indexOf(stage);
    const skippedGate = g.key === "rectification" && j.rectificationNeeded === false;
    const steps: JourneyStep[] = stages.map((s) => ({
      stage: s, label: STAGE_LABEL[s], action: DEFAULT_NEXT_ACTION[s], actor: waitingOn(s, STORED_NEXT_ACTION[s]), legacy: !g.steps.includes(s),
      status: skippedGate ? "skipped" : gi < 0 ? "upcoming" : i < gi ? "done" : i > gi ? "upcoming"
        : s === stage ? "current" : cur >= 0 && order.indexOf(s) < cur && g.steps.includes(s) && !(g.legacy ?? []).includes(stage) ? "done" : "upcoming",
    }));
    // Legacy current stage: earlier live steps in the same gate count as done only if the stage is live.
    let status: GateStatus = skippedGate ? "skipped" : gi < 0 ? "upcoming" : i < gi ? "done" : i > gi ? "upcoming" : "current";
    if (status === "current" && blocked) status = "blocked";
    let note: string | null = null;
    if (skippedGate) note = "Not needed – PIESA found nothing to fix";
    else if (g.key === "rectification" && status === "done" && j.rectificationNeeded == null) note = "Completed or not needed";
    else if (g.key === "ready_check" && status === "done") note = "Done, or skipped because the installer's Ready Check was approved";
    else if (g.key === "rectification" && status === "upcoming") note = "Only if the PIESA finds electrical work";
    if (status === "current" || status === "blocked") note = ns.next;
    return { key: g.key, number: i + 1, title: g.title, status, note, steps };
  });
  if (stage === "complete") for (const g of gates) { if (g.status !== "skipped") g.status = "done"; for (const s of g.steps) if (s.status !== "skipped") s.status = "done"; }

  const current = exception || stage === "complete" ? null : gates[gi] ?? null;
  const flat = gates.flatMap((g) => g.steps.filter((s) => !s.legacy && s.status !== "skipped"));
  const at = flat.findIndex((s) => s.stage === stage);
  const upNext = exception || stage === "complete" ? [] : flat.slice((at < 0 ? flat.findIndex((s) => s.status === "upcoming") - 1 : at) + 1).filter((s) => s.status === "upcoming").slice(0, 3);
  const headline = exception ? (exception === "on_hold" ? "On hold" : "Cancelled") : stage === "complete" ? "Complete" : current ? `Gate ${current.number} – ${current.title}` : ns.label;
  return { gates, current, upNext, headline, next: ns.next, exception, mismatches: j.mismatches ?? [] };
}
