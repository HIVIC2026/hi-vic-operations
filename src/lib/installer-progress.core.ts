// Installer job page progress + one next action for installer-supplied (intake) jobs. Pure presentation from real records.
// Never decides workflow: each step is "done" only from its own fact (never from stage order).

export type ProgressStepKey = "review" | "quote" | "electrical" | "installation" | "evidence" | "veec";
export type ProgressStep = { key: ProgressStepKey; label: string; state: "done" | "current" | "todo"; note: string | null };
export type QuoteDelivery = "released" | "queued" | "held" | "none";
export type EvidenceItem = { label: string; status: string; role: string | null; applicability: "current" | "future" | "unknown" };
export type ProgressFacts = {
  coordination: "hivic_managed" | "self_managed" | null;
  /** Installer's explicit measured-and-quoted answer (not price readiness). */
  quoted: "yes" | "no" | null;
  /** Installer's explicit attendance answer (jobs.installer_site_check); null = not recorded. Never inferred from price/area/files. */
  attended?: "yes" | "no" | null;
  /** A GST-inclusive quote amount is recorded; false for a file-only quote the office must still read. */
  quoteAmountKnown?: boolean;
  eligibility: "eligible" | "declined" | "unresolved";
  quoteHeld: string[];
  /** Status of the CURRENT (latest non-withdrawn) installation quote; older accepted history never wins over a newer replacement. */
  quoteStatus: "none" | "draft" | "issued" | "accepted";
  /** Actual release record of the current quote: "released" only with release_state=released AND sent_at recorded. */
  quoteDelivery: QuoteDelivery;
  quoteHoldReason?: string | null;
  reconfirmationRequired: boolean;
  electricianPayer: "hivic" | "own" | "undecided";
  /** Current PIESA record with a pass outcome AND a recorded sign-off (an uploaded report alone is not clearance). */
  electricalCleared: boolean;
  /** 30-day installation window from the current PIESA has expired (job_piesa_deadlines). */
  electricalExpired?: boolean;
  /** Job is in an electrical fix-up stage. */
  rectificationOpen?: boolean;
  /** Latest installation booking (proposed/confirmed/completed), if any. */
  installBooking?: { status: string; start: string | null } | null;
  /** Existing install-readiness blockers (ESC notice, consent, PIESA window) for the current booking. */
  installBlockers?: string[];
  installationCompleted: boolean;
  /** Required evidence items with their responsible party and applicability. */
  evidence: EvidenceItem[];
  /** Latest AP approval, counted only while it is still current (see apApprovalCurrent). */
  evidenceApprovedAt: string | null;
  veecStatus: string | null;
  stage: string;
  now?: number;
};
export type NextAction = { who: "You" | "Home Insulation Victoria" | "Owner" | "Electrician" | "Regulator" | null; text: string };

export const PROGRESS_LABELS: Record<ProgressStepKey, string> = {
  review: "Job review", quote: "Quote", electrical: "Electrical safety", installation: "Installation", evidence: "Evidence review", veec: "VEEC submission",
};

const OK = new Set(["verified", "not_required"]);
/** An AP approval counts only while the job still sits after AP review and every applicable required item is verified (none rejected/awaiting review/corrected after approval). */
export function apApprovalCurrent(f: { stage: string; approvedAt: string | null; evidence: EvidenceItem[]; lastVerifiedAt?: string | null }): boolean {
  if (!f.approvedAt) return false;
  if (!["ready_for_veec", "complete"].includes(f.stage)) return false;
  if (f.evidence.some((e) => e.applicability !== "future" && !OK.has(e.status))) return false;
  if (f.lastVerifiedAt && Date.parse(f.lastVerifiedAt) > Date.parse(f.approvedAt)) return false;
  return true;
}

function partyOf(role: string | null): "You" | "Electrician" | "Home Insulation Victoria" {
  return role === "installer" ? "You" : role === "electrician" ? "Electrician" : "Home Insulation Victoria";
}

/** Exact next evidence action: missing/rejected goes to the responsible party; uploaded = waiting for HIV review. */
export function evidenceNext(items: EvidenceItem[]): NextAction | null {
  const open = items.filter((e) => e.applicability !== "future");
  const order: ("You" | "Electrician" | "Home Insulation Victoria")[] = ["You", "Electrician", "Home Insulation Victoria"];
  for (const status of ["rejected", "outstanding"]) {
    for (const who of order) {
      const hit = open.filter((e) => e.status === status && partyOf(e.role) === who);
      if (!hit.length) continue;
      const names = hit.map((e) => e.label).join(", ");
      const verb = status === "rejected" ? "Replace rejected evidence" : "Upload missing evidence";
      return { who, text: who === "You" ? `${verb}: ${names}.` : who === "Electrician" ? `Electrician to ${verb.toLowerCase()}: ${names}.` : `Office to provide ${status === "rejected" ? "replacement" : "missing"} evidence: ${names}.` };
    }
  }
  const waiting = open.filter((e) => e.status === "uploaded");
  if (waiting.length) return { who: "Home Insulation Victoria", text: `Review uploaded evidence: ${waiting.map((e) => e.label).join(", ")}.` };
  return null;
}

export function installerProgress(f: ProgressFacts): { steps: ProgressStep[]; next: NextAction } {
  const veecSubmitted = f.veecStatus === "submitted" || f.veecStatus === "approved" || f.veecStatus === "query";
  const done: Record<ProgressStepKey, boolean> = {
    review: f.eligibility === "eligible",
    quote: f.quoteStatus === "accepted" && !f.reconfirmationRequired,
    electrical: f.electricalCleared,
    installation: f.installationCompleted,
    evidence: f.evidenceApprovedAt != null,
    veec: veecSubmitted,
  };
  const notes: Partial<Record<ProgressStepKey, string>> = {};
  if (f.eligibility === "declined") notes.review = "Not eligible";
  if (f.quoteStatus === "issued") notes.quote = f.quoteDelivery === "released" ? "Available to owner" : "Waiting to be sent";
  if (f.reconfirmationRequired) notes.quote = f.quoteStatus === "issued" && f.quoteDelivery === "released" ? "Owner must reconfirm" : "Updated quote being prepared";
  if (f.electricalCleared && f.electricalExpired) notes.electrical = "Completed — 30-day window expired";
  else if (f.rectificationOpen) notes.electrical = "Fix-up required";
  if (f.veecStatus === "approved") notes.veec = "Registered";
  else if (f.veecStatus === "submitted") notes.veec = "Submitted — awaiting registration";
  else if (f.veecStatus === "query") notes.veec = "Submitted — regulator query";
  else if (f.veecStatus === "rejected") notes.veec = "Rejected by regulator";
  const keys: ProgressStepKey[] = ["review", "quote", "electrical", "installation", "evidence", "veec"];
  const firstOpen = keys.find((k) => !done[k]) ?? null;
  const steps = keys.map((k) => ({ key: k, label: PROGRESS_LABELS[k], state: done[k] ? "done" as const : k === firstOpen ? "current" as const : "todo" as const, note: notes[k] ?? null }));
  return { steps, next: nextAction(f, done) };
}

function nextAction(f: ProgressFacts, done: Record<ProgressStepKey, boolean>): NextAction {
  const HIV = "Home Insulation Victoria" as const;
  const now = f.now ?? Date.now();
  if (f.stage === "cancelled") return { who: null, text: "This job was cancelled." };
  if (f.stage === "on_hold") return { who: HIV, text: "Job is on hold while the office reviews it." };
  if (f.eligibility === "declined") return { who: null, text: "The owner isn't eligible, so this job won't go ahead." };
  const quotedYes = f.quoted === "yes";
  if (f.eligibility !== "eligible") {
    // Office owns eligibility; the follow-on wording respects the attendance answer (never assumes a visit).
    if (!quotedYes && f.attended === "yes") return { who: HIV, text: "Check the owner's eligibility. You then finish any missing assessment details and add your price on this job — no second visit is booked." };
    if (quotedYes && f.attended === "no") return { who: HIV, text: "Check the owner's eligibility. Your quote is preliminary until the onsite Ready Check." };
    if (quotedYes && f.attended == null) return { who: HIV, text: "Check the owner's eligibility. Also tell us whether you attended and assessed this property — a quote alone isn't treated as a visit." };
    return { who: HIV, text: quotedYes ? "Check the owner's eligibility, then prepare the owner quote."
      : f.coordination === "self_managed" ? "Check the owner's eligibility. Then you measure and quote the job and add it below."
      : "Check the owner's eligibility, then arrange the Ready Check." };
  }
  if (!done.quote) {
    const released = f.quoteStatus === "issued" && f.quoteDelivery === "released";
    if (f.quoteStatus === "issued" && !released) return { who: HIV, text: f.quoteDelivery === "held" && f.quoteHoldReason ? `Owner quote not sent yet: ${f.quoteHoldReason}` : "Owner quote approved — waiting to be sent to the owner." };
    if (f.reconfirmationRequired) return released ? { who: "Owner", text: "Reconfirm the updated quote." } : { who: HIV, text: "Prepare and send the updated quote for the owner to reconfirm." };
    if (released) return { who: "Owner", text: "Review and accept the quote." };
    // A current prepared draft is the actual quote record: it outranks an earlier "not quoted yet" answer.
    if (f.quoteStatus === "draft" && !(quotedYes && f.quoteAmountKnown === false) && quotedYes && f.attended === "no") return { who: HIV, text: `Owner quote draft is preliminary — the onsite Ready Check is still required before a confirmed quote${f.quoteHoldReason ? ` (on hold: ${f.quoteHoldReason})` : f.quoteHeld.length ? ` (on hold: ${f.quoteHeld[0]})` : ""}.` };
    if (f.quoteStatus === "draft" && !(quotedYes && f.quoteAmountKnown === false)) return { who: HIV, text: f.quoteHoldReason ? `Review and complete the owner quote — on hold: ${f.quoteHoldReason}` : f.quoteHeld.length ? `Review and complete the owner quote — on hold: ${f.quoteHeld[0]}` : "Review and complete the owner quote." };
    // Attendance is independent of the quote (Jo, 20 Oct): visited+unquoted finishes on the same job, no second visit;
    // quoted+not visited keeps the price preliminary until the onsite Ready Check.
    if (f.attended === null && f.quoteStatus !== "draft") return { who: "You", text: "Tell us whether you've attended and assessed this property (job details below) — we don't assume either way." };
    if (!quotedYes && f.attended === "yes") return { who: "You", text: "Finish any missing assessment details and add your price on this job." };
    if (quotedYes && f.attended === "no" && f.quoteStatus !== "draft") return f.coordination === "self_managed"
      ? { who: "You", text: "Your quote is preliminary — complete the onsite assessment, then confirm the details below." }
      : { who: HIV, text: "Your quote is preliminary — arrange the onsite Ready Check before a confirmed owner quote." };
    if (!quotedYes) return f.coordination === "self_managed"
      ? { who: "You", text: "Measure and quote the job, then add the details below." }
      : { who: HIV, text: "Arrange the Ready Check so the job can be measured and quoted." };
    if (f.quoteAmountKnown === false && (f.quoteStatus === "none" || f.quoteStatus === "draft")) return { who: HIV, text: "Read your uploaded quote and confirm the amount and what it includes." };
    if (f.quoteHeld.length) return { who: f.quoteHeld.some((b) => /installer|you|area|quote|fee|electrician/i.test(b)) ? "You" : HIV, text: `Owner quote on hold: ${f.quoteHeld[0]}` };
    return { who: HIV, text: "Prepare and send the owner quote." };
  }
  if (!done.installation && f.rectificationOpen) return { who: f.electricianPayer === "own" ? "Electrician" : HIV, text: "Electrical fix-up required before installation can be booked." };
  if (!done.electrical) return f.electricianPayer === "own"
    ? { who: "Electrician", text: "Your electrician completes the electrical safety check; the office verifies the report." }
    : f.electricianPayer === "undecided" ? { who: "You", text: "Choose who arranges the electrician (below)." }
    : { who: HIV, text: "Arrange the electrical safety check." };
  if (!done.installation) {
    if (f.electricalExpired) return { who: HIV, text: "The electrical safety check's 30-day window has expired — a new check is needed before installation." };
    const b = f.installBooking;
    if (!b || !["proposed", "confirmed"].includes(b.status)) return { who: f.coordination === "self_managed" ? "You" : HIV, text: "Book the installation date." };
    if (b.status === "proposed") return { who: HIV, text: "Confirm the proposed installation date." };
    const when = b.start ? new Date(b.start).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }) : null;
    if (f.installBlockers?.length) return { who: HIV, text: `Before installation${when ? ` on ${when}` : ""}: ${f.installBlockers[0]}` };
    if (b.start && Date.parse(b.start) > now) return { who: "You", text: `Install on ${when}.` };
    return { who: "You", text: "Complete the booked installation and record it." };
  }
  if (!done.evidence) return evidenceNext(f.evidence) ?? { who: HIV, text: "Final AP review of the installation evidence." };
  if (f.veecStatus === "rejected") return { who: HIV, text: "Resolve the regulator's rejection." };
  if (!done.veec) return { who: HIV, text: "Submit the VEEC claim." };
  if (f.veecStatus === "approved") return { who: null, text: "VEECs registered — nothing more to do." };
  if (f.veecStatus === "query") return { who: HIV, text: "Answer the regulator's query." };
  return { who: "Regulator", text: "Registration decision on the submitted VEEC claim." };
}

/** Pick the current installation quote: the newest non-withdrawn row. Older accepted history never wins over a newer replacement. */
export function currentQuote<T extends { status: string; created_at: string; release_state?: string | null; sent_at?: string | null }>(rows: T[]): { status: ProgressFacts["quoteStatus"]; delivery: QuoteDelivery; row: T | null } {
  const live = rows.filter((r) => ["draft", "issued", "accepted"].includes(r.status)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const row = live[0] ?? null;
  if (!row) return { status: "none", delivery: "none", row: null };
  const delivery: QuoteDelivery = row.release_state === "released" && row.sent_at ? "released" : row.release_state === "queued" ? "queued" : row.release_state === "held" ? "held" : "none";
  return { status: row.status as ProgressFacts["quoteStatus"], delivery, row };
}

// ---- Installer Jobs tabs (My work) ----
export type InstallerTab = "action" | "progress" | "done";
export const INSTALLER_TABS: { key: InstallerTab; label: string }[] = [
  { key: "action", label: "Action needed" }, { key: "progress", label: "In progress" }, { key: "done", label: "Done" },
];
/** Done only from an actual final stage; Action needed only when the trade has a real task or offer. */
export function installerTab(place: "offers" | "needs_me" | "coming_up" | "moving", stage: string): InstallerTab {
  if (stage === "complete" || stage === "cancelled") return "done";
  if (place === "offers" || place === "needs_me") return "action";
  return "progress";
}
export function doneReason(stage: string): string {
  return stage === "cancelled" ? "Cancelled" : stage === "complete" ? "Job complete" : "Closed";
}

/** Intake progress applies only to installer-sourced jobs with a supplying business; a missing row never applies. */
export function intakeProgressApplies(job: { channel?: string | null; originating_installer_business_id?: string | null } | null | undefined): boolean {
  return !!job && job.channel === "installer_sourced" && !!job.originating_installer_business_id;
}

/** A jobs read used for attendance/progress must succeed AND find the row: a failed read is never "unknown attendance". */
export function requireJobRead<T>(r: { data: T | null; error: { message: string } | null }, what = "This job's progress"): T {
  if (r.error) throw new Error(`${what} could not load. Please retry.`);
  if (r.data == null) throw new Error(`${what} could not load: the job was not found.`);
  return r.data;
}
/** Any other progress read failing fails the whole view closed (never shows an empty/wrong next step). */
export function requireReads(rs: { error: { message: string } | null }[], what = "This job's progress"): void {
  if (rs.some((r) => r.error)) throw new Error(`${what} could not load. Please retry.`);
}
