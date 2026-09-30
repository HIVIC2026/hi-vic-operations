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
};

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
  const piesaDeadline = f.piesaCompletedAt ? iso(t(f.piesaCompletedAt) + windowDays * DAY_MS) : null;
  const signed = !!f.acceptanceSignedAt && !!f.assignmentSignedAt;
  const gates: Gate[] = [];
  const push = (g: Gate) => gates.push(g);

  push({ key: "acceptance_signed", label: "Customer Acceptance signed", when: "At quote acceptance", status: f.acceptanceSignedAt ? "done" : "open", dueAt: null, detail: null, blocks: "Invoice, deposit and REC request" });
  push({ key: "veec_assignment_signed", label: "Conditional VEEC rights assignment signed by owner", when: "At quote acceptance", status: f.assignmentSignedAt ? "done" : "open", dueAt: null, detail: null, blocks: "Invoice, deposit and REC request" });
  push({ key: "deposit_cleared", label: "50% deposit paid (Xero) or audited override", when: "Before any booking", status: f.depositCleared ? "done" : signed ? "open" : "blocked", dueAt: null, detail: signed ? null : "Waiting for signed acceptance", blocks: "REC and installer scheduling" });

  const piesaStatus: GateStatus = f.piesaCompletedAt ? (f.piesaOutcome === "pass" ? "done" : "blocked") : f.depositCleared ? "open" : "blocked";
  push({ key: "piesa_completed", label: "PIESA completed and passed (licensed electrician/REC)", when: "After deposit, before install", status: piesaStatus, dueAt: null, detail: f.piesaCompletedAt && f.piesaOutcome !== "pass" ? `PIESA outcome: ${f.piesaOutcome ?? "not recorded"} — rectification required` : null, blocks: "Ready to install" });

  push({ key: "owner_esc_consent", label: "Owner ESC consent (Reg 23A)", when: "≥24h before install", status: f.installStart ? deadline(f.ownerEscConsentAt, pre24, f.now) : f.ownerEscConsentAt ? "done" : "not_yet", dueAt: pre24, detail: null, blocks: "Ready to install" });
  push({ key: "esc_notified", label: "ESC notified of upcoming installation", when: "5 days to 24h before install", status: f.installStart ? deadline(f.escSentAt, pre24, f.now, f.escSentAt ? null : escEarliest) : f.escSentAt ? "done" : "not_yet", dueAt: pre24, detail: escEarliest ? `Window opens ${escEarliest}` : null, blocks: "Installation start" });
  push({ key: "piesa_copies_delivered", label: "PIESA copies given to owner and installer", when: "≥24h before install", status: f.installStart ? deadline(f.piesaCopiesDeliveredAt, pre24, f.now) : f.piesaCopiesDeliveredAt ? "done" : "not_yet", dueAt: pre24, detail: null, blocks: "Ready to install" });

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
  push({ key: "installer_declaration", label: "Installer declaration", when: "After install", status: f.installerDeclarationAt ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "AP review" });
  push({ key: "evidence_complete", label: "Installation evidence complete", when: "After install", status: f.evidenceComplete ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "AP review" });
  push({ key: "assignment_effective", label: "VEEC assignment final facts + installer and AP signatures", when: "After install", status: f.assignmentEffective ? "done" : installed ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Ready for VEEC" });
  const apReady = f.installerDeclarationAt && f.evidenceComplete && f.assignmentEffective;
  push({ key: "ap_approved", label: "AP final review approved", when: "After evidence", status: f.apApprovedAt ? "done" : apReady ? "open" : "not_yet", dueAt: null, detail: null, blocks: "Ready for VEEC" });
  push({ key: "veec_lodged", label: "VEEC lodgement recorded", when: "After AP approval", status: f.veecLodgedAt ? "done" : f.apApprovedAt ? "open" : "not_yet", dueAt: null, detail: "Lodgement deadline to be confirmed against the official ESC guide", blocks: "Complete" });
  return gates;
}

/** Most urgent gates first, for office queues. */
export function urgentGates(gates: Gate[]): Gate[] {
  const rank: Record<GateStatus, number> = { overdue: 0, blocked: 1, due_soon: 2, open: 3, not_yet: 9, done: 9 };
  return gates.filter((g) => rank[g.status] < 9).sort((a, b) => rank[a.status] - rank[b.status]);
}
