// Preview-only read model. Never used by workflow guards or production status functions.
import { isMappedStage, officeStatus, type JobFacts } from "./office-status.core";
import { STAGE_ORDER } from "./workflow";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";

export type OperationBucket = "Leads" | "Active jobs" | "Closed jobs" | "Needs classification";
export const PARTIES = ["Office", "Homeowner", "Installer", "Electrician", "System", "Capacity"] as const;
export type Party = typeof PARTIES[number];
export type OperationTask = { party: Party; label: string; dueAt?: string | null; overdue?: boolean; blocked?: boolean };
export type CommunicationFact = { purpose: string; status: string; at: string | null; error?: string | null; recordedAt?: string | null; actionKey?: string | null };
export type OperationInput = {
  id: string; jobNumber: string; owner: string | null; address: string | null;
  source: string | null; channel: string | null; businessUnit: string | null;
  originatingInstaller: string | null; assignedInstaller: string | null;
  facts: JobFacts; eligibility: string | null; eligibilityReason: string | null;
  verifiedEligibility: string | null; insulation: "none" | "present" | "unknown" | null;
  mediaCount: number; mediaReview: "below_r2" | "over_r2" | "unclear" | null;
  actualHandoff: boolean; insulationOnlyPassed?: boolean; paymentDueAt?: string | null;
  evidence: { label: string; status: string; role?: string | null; gate?: string | null }[];
  communications: CommunicationFact[]; failures: string[];
};
export type AutomationControl = { label: string; state: "Enabled" | "Paused" | "Unknown"; detail: string };
export type OperationRow = OperationInput & {
  bucket: OperationBucket; process: string; eligibilityLabel: string; eligibilityGroup: string;
  savedSpot: boolean; spotSavedOpen: boolean; mediaToReview: boolean; mediaState: string; communication: CommunicationFact | null;
  communicationLabel: string; tasks: OperationTask[]; nextAction: string;
  issues: string[]; onHold: boolean; overdue: boolean; blocked: boolean;
};
export const PROCESS_ORDER = ["Eligibility & estimate", "Insulation review", "Offer & owner response", "Spot saved — waiting for availability", "Ineligible enquiry", "On hold", "Ready Check", "Quote & payment", "Electrical safety & fixes", "Installation", "Evidence & AP review", "VEEC lodgement", "Completed", "Cancelled", "Needs classification"];
const PRE_HANDOFF = new Set(["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule"]);
const validTime = (at: string | null | undefined) => !!at && Number.isFinite(Date.parse(at));
export function communicationLabel(c: CommunicationFact | null): string {
  if (!c) return "No recorded send";
  if (["delivered_unrecorded", "sending", "sent_unknown"].includes(c.status)) return "Send outcome unknown — do not resend";
  if (["failed", "bounced", "undelivered"].includes(c.status)) return `Delivery failed${c.error ? `: ${c.error}` : ""}`;
  if (["sent", "delivered"].includes(c.status) && validTime(c.at)) return c.status === "delivered" ? "Delivered — timestamp recorded" : "Sent — timestamp recorded";
  if (["queued", "held", "pending"].includes(c.status)) return `${c.status === "held" ? "Held" : "Queued"} — not sent`;
  return "No confirmed send — status or timestamp missing";
}
export function sendingControlState(approved: boolean, global: boolean | null | undefined, delivery: boolean | null | undefined): "Enabled" | "Paused" | "Unknown" {
  if (global === false || delivery === false || !approved) return "Paused";
  if (global == null || delivery == null) return "Unknown";
  return "Enabled";
}
export function communicationAction(c: CommunicationFact): string | null {
  if (c.purpose === "preliminary_ineligible") return "ineligible";
  if (c.purpose === "step3_estimate") return "estimate";
  if (c.purpose === LAUNCH_CAMPAIGN && c.actionKey?.startsWith(`${LAUNCH_CAMPAIGN}:insulation_details:`)) return "photos";
  if (c.purpose === LAUNCH_CAMPAIGN && c.actionKey?.startsWith(`${LAUNCH_CAMPAIGN}:save_my_spot:`)) return "estimate";
  return null; // generic/manual correspondence and ambiguous legacy campaigns are history only
}
export function latestCommunicationActions(history: CommunicationFact[]) {
  const current = new Map<string, CommunicationFact>();
  for (const c of [...history].sort((a,b) => (a.recordedAt ?? a.at ?? "").localeCompare(b.recordedAt ?? b.at ?? ""))) {
    const action = communicationAction(c);
    if (action) current.set(action, c);
  }
  return current;
}
export function evidenceApplicability(gate: string | null | undefined, f: JobFacts, now: number): "current" | "future" | "unknown" {
  if (!["assessment", "electrical", "installation"].includes(gate ?? "")) return "unknown";
  // Reuse the canonical stage order, collection milestones and AP entry barrier.
  // There is no domain mapping for an unknown/on-hold stage: never infer its previous stage.
  const at = STAGE_ORDER.findIndex(s => s === f.stage);
  // The legacy electrical branch follows piesa_complete in STAGE_ORDER, but
  // that ordering is not proof that its PIESA or Ready Check happened.
  const modernAt = at >= 0 && at < STAGE_ORDER.findIndex(s => s === "awaiting_electrician");
  const reached = (stage: string) => modernAt && at >= STAGE_ORDER.findIndex(s => s === stage);
  const afterInstall = ["evidence_outstanding", "ap_review", "ready_for_veec", "complete"].includes(f.stage);
  if (f.installedAt || afterInstall) return "current";
  // Installation entry is downstream of both assessment and electrical guards.
  if (["installation_scheduling", "installation_booked"].includes(f.stage) && gate !== "installation") return "current";
  const visitDue = (date: string | null | undefined) => validTime(date) && Date.parse(date ?? "") <= now;
  if (gate === "assessment" && (f.rcSubmittedAt || reached("ready_check_complete") || visitDue(f.rcBookingAt))) return "current";
  if (gate === "electrical" && (f.piesa?.completedAt || reached("piesa_complete") || visitDue(f.elecBookingAt))) return "current";
  if (gate === "installation" && visitDue(f.installBookingAt)) return "current";
  if (at < 0) return "unknown";
  if (!modernAt && gate !== "installation") return "unknown";
  return "future";
}
export function operationalQuote(q: JobFacts["quote"]): boolean {
  return !!q && (q.status === "accepted" && validTime(q.acceptedAt) || q.status === "issued" && validTime(q.sentAt) && q.releaseState !== "held");
}
export function classifyOperation(input: OperationInput, now: number): OperationRow {
  const f = input.facts;
  const savedSpot = validTime(f.campaign?.spotSavedAt) && !f.campaign?.optedOutAt;
  const onHold = f.stage === "on_hold";
  const issues: string[] = [];
  const communications = [...input.communications].sort((a,b) => (a.recordedAt ?? a.at ?? "").localeCompare(b.recordedAt ?? b.at ?? ""));
  const currentActions = latestCommunicationActions(communications);
  const confirmed = (action: string) => { const c = currentActions.get(action); return !!c && ["sent", "delivered"].includes(c.status) && validTime(c.at); };
  const pendingLabel = (action: string, fallback: string) => { const c = currentActions.get(action); return c && ["delivered_unrecorded", "sending", "sent_unknown"].includes(c.status) ? `${action === "photos" ? "Insulation request" : action === "ineligible" ? "Ineligible email" : "Estimate"} send outcome unknown — do not resend` : fallback; };
  const communication = communications.at(-1) ?? null;
  const commLabel = communicationLabel(communication);
  const estimateContact = confirmed("estimate"), photoContact = confirmed("photos"), ineligibleContact = confirmed("ineligible");
  const reviewedUnsuitable = input.mediaReview === "over_r2";
  const ineligible = input.eligibility === "does_not_appear_eligible" || input.verifiedEligibility === "not_eligible" || reviewedUnsuitable;
  const eligibilityLabel = input.verifiedEligibility === "eligible" ? "Verified eligible"
    : input.verifiedEligibility === "not_eligible" ? "Verified ineligible"
    : ineligible ? "Recorded ineligible" : input.mediaReview === "below_r2" ? "Insulation reviewed below R2 — preliminary eligibility"
    : input.eligibility === "likely_eligible" ? "Preliminary likely eligible"
    : input.eligibility === "needs_onsite_confirmation" ? input.insulationOnlyPassed ? "Preliminary — insulation confirmation needed" : "Preliminary — other eligibility checks need review" : "Eligibility not recorded";
  const eligibilityGroup = reviewedUnsuitable ? "Reviewed unsuitable insulation" : ineligible ? "Other ineligible"
    : input.insulation === "none" && input.eligibility === "likely_eligible" ? "Likely eligible / no insulation"
    : input.mediaReview === "below_r2" ? "Reviewed below R2"
    : input.eligibility === "needs_onsite_confirmation" && input.insulation && input.insulationOnlyPassed ? "Otherwise eligible / existing or unknown insulation pending review" : "Other / unmapped eligibility";
  const mediaState = input.mediaReview === "unclear" ? "Reviewed — clearer pictures needed"
    : input.mediaReview ? "Media reviewed" : input.mediaCount > 0 ? `${input.mediaCount} photos/videos available for review` : input.insulation !== "none" || f.campaign?.videoRequested ? "Awaiting upload — no media recorded" : "No media recorded / not requested";
  const active = input.actualHandoff || !!f.rcOfferAt || !!f.rcBookingAt || !!f.rcSubmittedAt || operationalQuote(f.quote) || !!f.elecOfferAt || !!f.elecBookingAt || !!f.installBookingAt || !!f.installedAt;
  let bucket: OperationBucket = f.stage === "complete" || f.stage === "cancelled" ? "Closed jobs" : active || (!PRE_HANDOFF.has(f.stage) && !onHold) ? "Active jobs" : "Leads";
  let process = "Eligibility & estimate";
  const tasks: OperationTask[] = [];
  const add = (party: Party, label: string, dueAt?: string | null, blocked = false) => tasks.push({ party, label, dueAt: validTime(dueAt) ? dueAt ?? null : null, overdue: validTime(dueAt) && Date.parse(dueAt ?? "") < now, blocked });
  if (!input.source) issues.push("Enquiry source is missing");
  if (!isMappedStage(f.stage)) issues.push(`Unknown persisted stage: ${f.stage}`);
  if (input.eligibility && !["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"].includes(input.eligibility)) issues.push(`Unknown eligibility result: ${input.eligibility}`);
  if (input.verifiedEligibility === "stale") issues.push("Verified eligibility is stale; office reconciliation required");
  if (!["hivic_sourced", "installer_sourced"].includes(input.channel ?? "")) issues.push("Customer source route is missing or unknown");
  if (input.verifiedEligibility === "eligible" && ineligible) issues.push("Verified eligibility conflicts with recorded ineligibility");
  if (input.mediaReview === "below_r2" && input.eligibility === "does_not_appear_eligible") issues.push("Below-R2 review conflicts with recorded ineligibility; office decision required");
  const expectedBooking = f.stage === "ready_check_scheduled" ? f.rcBookingAt : f.stage === "installation_booked" ? f.installBookingAt : f.stage === "rectification_booked" ? f.rectBookingAt : f.elecBookingAt;
  if (["ready_check_scheduled", "installation_booked", "piesa_scheduled", "rectification_booked", "assessment_booked"].includes(f.stage) && !validTime(expectedBooking)) issues.push("Booked stage has no supporting booking timestamp");
  if (bucket === "Closed jobs") process = f.stage === "complete" ? "Completed" : "Cancelled";
  else if (onHold) { process = "On hold"; add("Office", input.eligibilityReason ?? "Review recorded hold", f.holdRevisitAt, true); }
  else if (bucket === "Leads") {
    if (ineligible) { process = "Ineligible enquiry"; if (!ineligibleContact) add("System", pendingLabel("ineligible", "Ineligible email has no confirmed send")); }
    else if (input.mediaCount > 0 && !input.mediaReview) { process = "Insulation review"; add("Office", "Review received insulation photos/video"); }
    else if (savedSpot) { process = "Spot saved — waiting for availability"; add("Capacity", "Waiting for onboarded installer availability"); }
    else if (input.insulation !== "none" && input.mediaReview !== "below_r2") { process = "Insulation review"; add(photoContact ? "Homeowner" : "System", photoContact ? "Provide insulation pictures or information" : pendingLabel("photos", "Insulation request has no confirmed send")); }
    else { process = estimateContact ? "Offer & owner response" : "Eligibility & estimate"; add(estimateContact ? "Homeowner" : "System", estimateContact ? "Save a spot or respond to estimate" : pendingLabel("estimate", "Eligibility / estimate delivery pending")); }
    if (!input.eligibility) issues.push("No recorded eligibility result");
    if (!input.insulation && !ineligible) issues.push("Existing insulation answer missing");
  } else {
    const operationalFacts = PRE_HANDOFF.has(f.stage) && active ? { ...f, stage: f.installedAt ? "evidence_outstanding" : f.installBookingAt ? "installation_booked" : f.elecBookingAt ? "piesa_scheduled" : f.elecOfferAt ? "piesa_and_install_window_pending" : operationalQuote(f.quote) && f.quote?.status === "accepted" ? "measured_quote_accepted" : operationalQuote(f.quote) ? "awaiting_quote_acceptance" : f.rcSubmittedAt ? "ready_check_complete" : f.rcBookingAt ? "ready_check_scheduled" : "ready_check_ready_to_schedule", campaign: null } : f;
    const currentEvidence = input.evidence.filter(e => evidenceApplicability(e.gate, operationalFacts, now) === "current");
    const status = officeStatus({ ...operationalFacts, evidenceMissing: currentEvidence.filter(e => ["outstanding", "rejected"].includes(e.status)).length }, now);
    const stage = status?.stage;
    process = stage === "quote" ? "Quote & payment" : stage === "safety" ? "Electrical safety & fixes" : stage === "install" ? "Installation" : stage === "signoff" ? (f.stage === "ready_for_veec" ? "VEEC lodgement" : "Evidence & AP review") : "Ready Check";
    const who = status?.waitingOn;
    const parties: Party[] = who === "Owner + Installer" ? ["Homeowner", "Installer"] : who === "Owner + Electrician" ? ["Homeowner", "Electrician"] : [who === "Us" || who === "Office / campaign" ? "Office" : who === "Owner" ? "Homeowner" : who === "Installer" ? "Installer" : who === "Electrician" ? "Electrician" : "System"];
    // Do not reuse legacy sent/overdue claims. Only evidence-backed deadlines survive here.
    const unconfirmedQuote = f.quote?.status === "issued" && !validTime(f.quote.sentAt);
    const action = f.quote?.releaseState === "held" ? f.quote.holdReason ?? "Review held quote" : f.quote?.status === "accepted" && !f.paymentCleared ? "Owner payment pending" : unconfirmedQuote ? "Quote delivery unconfirmed" : PRE_HANDOFF.has(f.stage) && !f.rcOfferAt && !f.rcBookingAt && !f.rcSubmittedAt && !operationalQuote(f.quote) ? "Arrange operational Ready Check handoff" : status?.action ?? status?.label ?? "Review operational records";
    // Explicit payment due date only; quote response has no stored expiry. Never borrow the PIESA clock.
    const taskDue = f.quote?.status === "accepted" && !f.paymentCleared ? input.paymentDueAt : null;
    for (const party of unconfirmedQuote ? ["System" as const] : parties) add(party, action.replace(/Quote sent automatically/i, "Quote delivery pending").replace(/Fix-up quote sent automatically/i, "Fix-up quote delivery pending").replace(/ \(30-day clock started\)/i, ""), taskDue, f.quote?.releaseState === "held");
    if (!f.installedAt && validTime(f.installDeadline)) add("Installer", "Installation must commence within the recorded PIESA window", f.installDeadline);
    if (!status) issues.push("No operational stage mapping");
  }
  for (const e of bucket === "Closed jobs" ? [] : input.evidence) {
    const applicability = evidenceApplicability(e.gate, f, now);
    if (applicability === "unknown") { issues.push(`Evidence applicability unknown: ${e.label} (gate ${e.gate ?? "missing"})`); continue; }
    if (applicability === "future") continue;
    if (["outstanding", "rejected"].includes(e.status)) add(e.role === "electrician" ? "Electrician" : e.role === "installer" ? "Installer" : "Office", `${e.label}: ${e.status === "rejected" ? "replacement required" : "not received"}`, null, true);
    else if (e.status === "uploaded") add("Office", `${e.label}: received, verification pending`);
    else if (!["verified", "not_required"].includes(e.status)) issues.push(`Unknown evidence status: ${e.label} (${e.status})`);
  }
  for (const [action, c] of currentActions) if (["failed", "bounced", "undelivered"].includes(c.status)) add("Office", `Customer ${action} ${c.status}`, null, true);
  for (const failure of input.failures) add("Office", failure, null, true);
  if (issues.length) { bucket = "Needs classification"; process = "Needs classification"; tasks.length = 0; add("Office", issues.join("; "), null, true); }
  const open = bucket === "Leads" || bucket === "Needs classification";
  return { ...input, bucket, process, savedSpot, spotSavedOpen: savedSpot && open, mediaToReview: input.mediaCount > 0 && !input.mediaReview && bucket !== "Closed jobs", onHold, eligibilityLabel, eligibilityGroup, mediaState, communication, communicationLabel: commLabel, tasks, nextAction: tasks.map((t) => t.label).join(" · ") || "No outstanding task recorded", issues, overdue: tasks.some((t) => t.overdue), blocked: tasks.some((t) => t.blocked) };
}
export function buildOperationsPreview(inputs: OperationInput[], controls: AutomationControl[], now: number) {
  const scoped = inputs.filter((r) => r.source !== "qa_test" && r.businessUnit === "hivic");
  const byId = new Map<string, OperationInput>();
  const duplicateIds = new Set<string>();
  for (const row of scoped) { if (byId.has(row.id)) duplicateIds.add(row.id); else byId.set(row.id, row); }
  const rows = [...byId.values()].map((r) => {
    const out = classifyOperation(r, now);
    if (duplicateIds.has(r.id)) { out.spotSavedOpen = out.savedSpot; out.bucket = "Needs classification"; out.process = "Needs classification"; out.issues.push("Duplicate job ID in read results"); out.tasks.push({ party: "Office", label: "Reconcile duplicate read rows", blocked: true }); out.blocked = true; }
    return out;
  });
  const buckets: OperationBucket[] = ["Leads", "Active jobs", "Closed jobs", "Needs classification"];
  const totals = Object.fromEntries(buckets.map((b) => [b, rows.filter((r) => r.bucket === b).length])) as Record<OperationBucket, number>;
  const stages = buckets.flatMap((bucket) => PROCESS_ORDER.map((process) => {
    const match = rows.filter((r) => r.bucket === bucket && r.process === process);
    return { bucket, process, total: match.length, tasks: match.reduce((n, r) => n + r.tasks.length, 0), parties: PARTIES.map((party) => ({ party, jobs: match.filter((r) => r.tasks.some((t) => t.party === party)).length, tasks: match.reduce((n, r) => n + r.tasks.filter((t) => t.party === party).length, 0) })), blocked: match.filter((r) => r.blocked).length, overdue: match.filter((r) => r.overdue).length };
  }).filter((s) => s.total > 0));
  /** Cross-cutting filters: a job can be in one stage and still be flagged here; never added to stage totals. */
  const flags = { spotSaved: rows.filter((r) => r.spotSavedOpen).length, mediaToReview: rows.filter((r) => r.mediaToReview).length };
  return { rows, controls, totals, stages, flags, loadedAt: new Date(now).toISOString(), reconciliation: { uniqueJobs: rows.length, bucketSum: Object.values(totals).reduce((a, b) => a + b, 0), stageSum: stages.reduce((a, b) => a + b.total, 0), duplicateIds: [...duplicateIds], excluded: inputs.length - scoped.length } };
}
export type OperationsPreview = ReturnType<typeof buildOperationsPreview>;