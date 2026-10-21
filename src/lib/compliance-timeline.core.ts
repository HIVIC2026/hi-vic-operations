import { addMelbourneBusinessDays, addMelbourneCalendarDays } from "./melbourne-time.core";
// Activity 48 AP compliance timeline – PURE (no I/O).
// One ordered list of timed/sequenced gates per job, each with status and due time.
// Timing constants reuse the existing central rules (esc.core) — never duplicated here.
import { LEAD_MS, EARLIEST_MS } from "./esc.core";

export const DAY_MS = 24 * 3600_000;
export const DEFAULT_PIESA_WINDOW_DAYS = 30;
export const WARN_MS = 48 * 3600_000;

export type GateStatus = "done" | "open" | "due_soon" | "overdue" | "not_yet" | "blocked";
export type GateKey =
  | "acceptance_signed" | "veec_assignment_signed" | "deposit_cleared" | "piesa_completed"
  | "owner_esc_consent" | "esc_notified" | "piesa_copies_delivered" | "install_within_piesa_window"
  | "life_support_plan" | "assignment_copy_to_consumer" | "installer_safety_assessment" | "pre_install_consumer_docs"
  | "co_payment_paid" | "completion_consumer_docs"
  | "installer_declaration" | "evidence_complete" | "assignment_effective" | "ap_approved" | "veec_lodged";

export type Gate = { key: GateKey; label: string; when: string; status: GateStatus; dueAt: string | null; detail: string | null; blocks: string };

export type TimelineFacts = {
  now: string;
  piesaWindowDays?: number | null;
  acceptanceSignedAt: string | null;
  assignmentSignedAt: string | null;
  depositCleared: boolean;
  piesaCompletedAt: string | null;
  piesaOutcome: "pass" | "fail" | "pending" | null;
  installStart: string | null;
  installCompletedAt: string | null;
  ownerEscConsentAt: string | null;
  escSentAt: string | null;
  piesaCopiesDeliveredAt: string | null;
  installerDeclarationAt: string | null;
  evidenceComplete: boolean;
  assignmentEffective: boolean;
  apApprovedAt: string | null;
  veecLodgedAt: string | null;
  lifeSupport?: boolean;
  lifeSupportPlanAt?: string | null;
  assignmentCopyGivenAt?: string | null;
  installerSafetyAssessmentAt?: string | null;
  preInstallDocsGivenAt?: string | null;
  coPaymentPaidAt?: string | null;
  completionDocsGivenAt?: string | null;
};

/** Adds n Melbourne business days (Mon–Fri, excluding Victorian public holidays); due at the end of that Melbourne day. */
export function addBusinessDays(startIso: string, n: number): string {
  return addMelbourneBusinessDays(startIso, n);
}

const t = (s: string) => new Date(s).getTime();
const iso = (n: number) => new Date(n).toISOString();

/** Status for a deadline-bound requirement. */
function deadline(doneAt: string | null, dueAt: string | null, now: string, earliest?: string | null): GateStatus {
  if (doneAt) return "done";
  if (!dueAt) return "not_yet";
  if (earliest && t(now) < t(earliest)) return "not_yet";
  const left = t(dueAt) - t(now);
  if (left < 0) return "overdue";
  return left <= WARN_MS ? "due_soon" : "open";
}

export function buildComplianceTimeline(f: TimelineFacts): Gate[] {
  const windowDays = f.piesaWindowDays && f.piesaWindowDays > 0 ? f.piesaWindowDays : DEFAULT_PIESA_WINDOW_DAYS;
  const pre24 = f.installStart ? iso(t(f.installStart) - LEAD_MS) : null;
  const escEarliest = f.installStart ? iso(t(f.installStart) - EARLIEST_MS) : null;
  // Melbourne calendar days: due at the end of the Melbourne day windowDays after the PIESA date (not windowDays × 24h).
  const piesaDeadline = f.piesaCompletedAt ? addMelbourneCalendarDays(f.piesaCompletedAt, windowDays) : null;
  const signed = !!f.acceptanceSignedAt;
  const gates: Gate[] = [];
  const push = (g: Gate) => gates.push(g);

  push({ key: "acceptance_signed", label: "Customer Acceptance signed", when: "At quote acceptance", status: f.acceptanceSignedAt ? "done" : "open", dueAt: null, detail: null, blocks: "Invoice, deposit and REC request" });
  push({ key: "veec_assignment_signed", label: "Completed Activity 48 VEEC assignment signed", when: "After installation and final facts are confirmed", status: f.assignmentSignedAt ? "done" : f.installCompletedAt ? "open" : "not_yet", dueAt: null, detail: null, blocks: "VEEC lodgement" });
  push({ key: "deposit_cleared", label: "Approved payment option verified (Xero) or audited override", when: "Before any booking", status: f.depositCleared ? "done" : signed ? "open" : "blocked", dueAt: null, detail: signed ? null : "Waiting for signed acceptance", blocks: "REC and installer scheduling" });

  push({ key: "assignment_copy_to_consumer", label: "Copy of signed VEEC assignment form given to owner", when: "At written signing, or within 10 business days if signed electronically", status: deadline(f.assignmentCopyGivenAt ?? null, f.assignmentSignedAt ? addBusinessDays(f.assignmentSignedAt, 10) : null, f.now), dueAt: f.assignmentSignedAt ? addBusinessDays(f.assignmentSignedAt, 10) : null, detail: null, blocks: "VEEC lodgement record" });
  if (f.lifeSupport) push({ key: "life_support_plan", label: "Life support written consent / medical plan", when: "Before PIESA starts", status: f.lifeSupportPlanAt ? "done" : "open", dueAt: null, detail: null, blocks: "PIESA and installation" });
  const piesaStatus: GateStatus = f.piesaCompletedAt ? (f.piesaOutcome === "pass" ? "done" : "blocked") : f.depositCleared ? "open" : "blocked";
  push({ key: "piesa_completed", label: "VEU Pre Insulation Electrical Safety Assessment (PIESA) completed, signed and passed", when: "No earlier than 30 days before installation", status: piesaStatus, dueAt: null, detail: f.piesaCompletedAt && f.piesaOutcome !== "pass" ? `Assessment outcome: ${f.piesaOutcome ?? "not recorded"} — electrical fixes required` : null, blocks: "Ready to install" });

  push({ key: "owner_esc_consent", label: "Owner ESC consent (Reg 23A)", when: "≥24h before install", status: f.installStart ? deadline(f.ownerEscConsentAt, pre24, f.now) : f.ownerEscConsentAt ? "done" : "not_yet", dueAt: pre24, detail: null, blocks: "Ready to install" });
  push({ key: "esc_notified", label: "ESC notified of upcoming installation", when: "5 days to 24h before install", status: f.installStart ? deadline(f.escSentAt, pre24, f.now, f.escSentAt ? null : escEarliest) : f.escSentAt ? "done" : "not_yet", dueAt: pre24, detail: escEarliest ? `Window opens ${escEarliest}` : null, blocks: "Installation start" });
  push({ key: "installer_safety_assessment", label: "VEU pre-installation installer safety assessment completed and signed", when: "Before works, within the electrical assessment's 30-day window", status: f.installerSafetyAssessmentAt ? "done" : f.installStart ? deadline(null, f.installStart, f.now) : "not_yet", dueAt: f.installStart, detail: null, blocks: "Installation start" });
  push({ key: "pre_install_consumer_docs", label: "Owner given Consumer Factsheet, Code of Conduct info, PIESA copy (+ CES if rectified)", when: "Before installation", status: f.installStart ? deadline(f.preInstallDocsGivenAt ?? null, f.installStart, f.now) : f.preInstallDocsGivenAt ? "done" : "not_yet", dueAt: f.installStart, detail: null, blocks: "Installation start" });
  push({ key: "piesa_copies_delivered", label: "Completed signed electrical assessment given to owner and installer", when: "≥24h before install", status: f.installStart ? deadline(f.piesaCopiesDeliveredAt, pre24, f.now) : f.piesaCopiesDeliveredAt ? "done" : "not_yet", dueAt: pre24, detail: null, blocks: "Ready to install" });

  let windowStatus: GateStatus = "not_yet";
  let windowDetail: string | null = null;
  if (piesaDeadline) {
    if (f.installCompletedAt) windowStatus = t(f.installCompletedAt) <= t(piesaDeadline) ? "done" : "overdue";
    else if (f.installStart && t(f.installStart) > t(piesaDeadline)) { windowStatus = "blocked"; windowDetail = "Booked install date is after the PIESA window — rebook or redo PIESA"; }
    else windowStatus = deadline(null, piesaDeadline, f.now);
    if (windowStatus === "overdue" && !f.installCompletedAt) windowDetail = "PIESA window expired — PIESA must be redone";
  }
  push({ key: "install_within_piesa_window", label: `Installation within ${windowDays} days of PIESA`, when: "After PIESA", status: windowStatus, dueAt: piesaDeadline, detail: windowDetail, blocks: "Installation" });

  const installed = !!f.installCompletedAt;
  push({ key: "co_payment_paid", label: "Minimum $200 inc GST co-payment paid by the energy consumer to the Accredited Person", when: "Before VEEC creation; must not be reimbursed", status: f.coPaymentPaidAt ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "VEEC creation" });
  push({ key: "completion_consumer_docs", label: "Owner given tax invoice, dispute info, instructions, contacts and 5-year warranty", when: "On completion", status: f.completionDocsGivenAt ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Final check" });
  push({ key: "installer_declaration", label: "Installer declaration", when: "After install", status: f.installerDeclarationAt ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Final check" });
  push({ key: "evidence_complete", label: "Installation evidence complete", when: "After install", status: f.evidenceComplete ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Final check" });
  push({ key: "assignment_effective", label: "VEEC assignment final facts + installer, AP and customer signatures", when: "After install", status: f.assignmentEffective ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Ready for VEEC" });
  const apReady = !!f.coPaymentPaidAt && !!f.completionDocsGivenAt && f.installerDeclarationAt && f.evidenceComplete && f.assignmentEffective;
  push({ key: "ap_approved", label: "AP final review approved", when: "After evidence", status: f.apApprovedAt ? "done" : apReady ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Ready for VEEC" });
  push({ key: "veec_lodged", label: "VEEC lodgement recorded", when: "After AP approval", status: f.veecLodgedAt ? "done" : f.apApprovedAt ? "open" : "not_yet", dueAt: null, detail: "No Activity 48 lodgement deadline found in ESC guides — confirm with ESC. Keep records 6 years after registration.", blocks: "Complete" });
  return gates;
}

/** Most urgent gates first, for office queues. */
export function urgentGates(gates: Gate[]): Gate[] {
  const rank: Record<GateStatus, number> = { overdue: 0, blocked: 1, due_soon: 2, open: 3, not_yet: 9, done: 9 };
  return gates.filter((g) => rank[g.status] < 9).sort((a, b) => rank[a.status] - rank[b.status]);
}

// ---- Enforcement: office-recorded Activity 48 items that gate real stage entry ----
export type RecordKey = "life_support_plan" | "assignment_copy_to_consumer" | "installer_safety_assessment" | "pre_install_consumer_docs" | "co_payment_paid" | "completion_consumer_docs";
export const RECORD_LABELS: Record<RecordKey, string> = {
  life_support_plan: "Life support written consent / medical plan",
  assignment_copy_to_consumer: "Copy of signed VEEC assignment form given to owner",
  installer_safety_assessment: "Completed signed VEU pre-installation installer safety assessment",
  pre_install_consumer_docs: "Owner given Consumer Factsheet, Code of Conduct info, PIESA copy (+ CES if rectified)",
  co_payment_paid: "Minimum $200 inc GST co-payment paid by the energy consumer to the Accredited Person and not reimbursed",
  completion_consumer_docs: "Owner given tax invoice, dispute info, instructions, contacts and 5-year warranty",
};
export const MIN_CO_PAYMENT_INC_GST = 200;

/** Which recorded items each stage needs (cumulative). Pure. */
export function complianceRecordBlockers(to: string, recorded: Set<RecordKey>, f: { lifeSupport: boolean; ownerPaidIncGst: number }): string[] {
  const need: RecordKey[] = [];
  if (f.lifeSupport && ["assessment_booked", "assessment_complete", "installation_booked", "evidence_outstanding"].includes(to)) need.push("life_support_plan");
  if (to === "evidence_outstanding") need.push("pre_install_consumer_docs");
  if (to === "ap_review" || to === "ready_for_veec") need.push("installer_safety_assessment", "completion_consumer_docs", "co_payment_paid");
  if (to === "ready_for_veec") need.push("assignment_copy_to_consumer");
  return need
    .filter((k) => !(recorded.has(k) || (k === "co_payment_paid" && f.ownerPaidIncGst >= MIN_CO_PAYMENT_INC_GST)))
    .map((k) => `Activity 48 record missing: ${RECORD_LABELS[k]}`);
}
