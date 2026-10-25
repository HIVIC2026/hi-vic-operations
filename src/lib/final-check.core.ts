// Decision 372 (Jo, 25 Oct 2026): ONE Final check screen per job — every pre-computed check with a tick or a cross, the
// reason when it fails and a link to the evidence; Approve is enabled only when every check passes. PURE: the server
// (`final-check.server.ts`) gathers the stored facts through the existing readers; this decides the list. It never
// approves anything: the human authorised action stays `approveApJob` (stage ap_review → ready_for_veec through
// `transition`, which re-runs every existing stageEntryBlockers guard). No auto-approve.
import type { CardKey } from "./office-stage-cards.core";
import { ASSIGNMENT_VEEC_BLOCKER } from "./assignment.core";
import { MISSING_INSTALLER_DECLARATION } from "./piisa-declaration.core";

export type FinalCheckKey =
  | "piesa" | "fixes" | "swms" | "piisa" | "install_evidence" | "esc_notice" | "consent" | "warranty" | "veec_assignment" | "payments" | "photos" | "other";
export type FinalCheckState = "pass" | "fail" | "not_needed";
export type FinalCheckEvidence = { label: string; card: CardKey | "money" };
export type FinalCheckItem = { key: FinalCheckKey; label: string; state: FinalCheckState; detail: string | null; why: string[]; evidence: FinalCheckEvidence | null };

export type FinalCheckFacts = {
  stage: string | null;
  /** Latest initial PIESA record (null = none) + the decision-296 owner confirmation blocker for it (null = confirmed). */
  piesa: { completedDate: string | null; outcome: string | null; ownerConfirmationBlocker: string | null } | null;
  /** Electrical fixes: needed when the PIESA failed or fixes items are open; recorded = post-fixes PIESA (A4 / CoES path) or fixed on the same visit. */
  fixes: { needed: boolean; sameVisit: boolean; postFixes: { completedDate: string | null; ownerConfirmed: boolean } | null };
  /** Portal safety plan (decision 261). Null = couldn't be read / no plan yet. */
  swms: { complete: boolean; missing: string[] } | null;
  /** Signed PIISA/A5 installer declaration + its A5 evidence gate (empty = complete). */
  piisa: { declarationSigned: boolean; blockers: string[] };
  /** Activity Guide Table 4 install evidence + Activity 48 product check (install-evidence.server). */
  installEvidence: string[];
  /** Required evidence photos (evidenceStageBlockers("ready_for_veec")). */
  photos: string[];
  esc: { sentAt: string | null; installStart: string | null };
  /** consentValidityBlockers for the booked start (empty = valid, owner + AP ≥24h before). */
  consentBlockers: string[];
  warranty: { providedAt: string | null; productsNotOnFile: string[] };
  veec: { status: string | null; installerSignedAt: string | null; apSignedAt: string | null; consumerSignedAt: string | null };
  /** Installation invoice (null = none raised). Amounts inc GST. */
  payments: { totalIncGst: number; totalPaid: number } | null;
  /** stageEntryBlockers(job, "ready_for_veec", viewer): every other existing guard, shown only when not already listed above. */
  guards: string[];
};

const DAY = 24 * 3600_000;
const ymd = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }).format(new Date(iso.length === 10 ? `${iso}T12:00:00+10:00` : iso)) : "");
const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const item = (key: FinalCheckKey, label: string, why: string[], detail: string | null, evidence: FinalCheckEvidence | null, notNeeded = false): FinalCheckItem =>
  ({ key, label, state: notNeeded ? "not_needed" : why.length ? "fail" : "pass", detail, why: notNeeded ? [] : why, evidence });

/** VEEC assignment order (decisions 119/120/271): lead installer → AP → owner, each after the one before. */
export function veecOrderProblems(v: FinalCheckFacts["veec"]): string[] {
  if (!v.status) return ["The VEEC assignment form has not been prepared yet."];
  const out: string[] = [];
  if (!v.installerSignedAt) out.push("Lead installer has not signed Section 3 Part B.");
  if (!v.apSignedAt) out.push("AP representative has not signed Section 3 Part A.");
  if (!v.consumerSignedAt) out.push("Owner has not signed Section 4 Part B.");
  const t = (x: string | null) => (x ? Date.parse(x) : null);
  const [i, a, c] = [t(v.installerSignedAt), t(v.apSignedAt), t(v.consumerSignedAt)];
  if (i != null && a != null && a < i) out.push("Signed out of order: the AP signed before the lead installer.");
  if (a != null && c != null && c < a) out.push("Signed out of order: the owner signed before the AP.");
  if (!out.length && v.status !== "effective_complete") out.push(`The form is ${v.status.replace(/_/g, " ")}, not complete.`);
  return out;
}

export function finalCheckList(f: FinalCheckFacts): FinalCheckItem[] {
  const items: FinalCheckItem[] = [];
  // 1. PIESA + the owner's confirmation (decision 296).
  const pw: string[] = [];
  if (!f.piesa) pw.push("No PIESA recorded.");
  else {
    if (f.piesa.outcome !== "pass" && !f.fixes.needed) pw.push(`PIESA outcome is ${f.piesa.outcome ?? "not recorded"}.`);
    if (f.piesa.ownerConfirmationBlocker) pw.push(f.piesa.ownerConfirmationBlocker);
  }
  items.push(item("piesa", "PIESA done and confirmed by the owner", pw, f.piesa ? `PIESA ${ymd(f.piesa.completedDate)}${f.piesa.ownerConfirmationBlocker ? "" : " · owner confirmed"}` : null, { label: "PIESA records", card: "piesa" }));
  // 2. Electrical fixes + CoES (only when fixes were needed).
  const fw: string[] = [];
  if (f.fixes.needed && !f.fixes.sameVisit) {
    if (!f.fixes.postFixes) fw.push("Electrical fixes (A4 form with the CoES) not recorded yet.");
    else if (!f.fixes.postFixes.ownerConfirmed) fw.push("Owner hasn't confirmed the electrical fixes (official PIESA owner declaration unticked).");
  }
  items.push(item("fixes", "Electrical fixes and CoES", fw, f.fixes.sameVisit ? "Fixed on the PIESA visit" : f.fixes.postFixes ? `Fixes certified ${ymd(f.fixes.postFixes.completedDate)}` : null, { label: "Electrical fixes", card: "piesa" }, !f.fixes.needed));
  // 3. SWMS signed by the lead and every listed installer (decision 261).
  items.push(item("swms", "Safety plan (SWMS) signed", !f.swms ? ["The safety plan couldn't be read or hasn't been prepared."] : f.swms.complete ? [] : [`Not signed by: ${f.swms.missing.join(", ") || "someone listed"}.`], f.swms?.complete ? "Lead and crew signed" : null, { label: "Install card · safety plan", card: "install" }));
  // 4. PIISA / A5 complete.
  // Same wording as the stage guard (MISSING_INSTALLER_DECLARATION), so it is listed once.
  items.push(item("piisa", "PIISA / A5 install form complete", [...(f.piisa.declarationSigned ? [] : [MISSING_INSTALLER_DECLARATION]), ...f.piisa.blockers], f.piisa.declarationSigned && !f.piisa.blockers.length ? "Signed PIISA on file" : null, { label: "Install card · PIISA", card: "install" }));
  // 5. Install evidence & product (Table 4 + the Activity 48 product register check).
  items.push(item("install_evidence", "Install evidence and product", f.installEvidence, f.installEvidence.length ? null : "Every Table 4 item and the product check passed", { label: "Install card · evidence", card: "install" }));
  // 6. Photos verified.
  items.push(item("photos", "Required photos verified", f.photos, f.photos.length ? null : "Every required photo verified", { label: "Install card · evidence checklist", card: "install" }));
  // 7. ESC installation notice ≥24h before the start.
  const ew: string[] = [];
  if (!f.esc.sentAt) ew.push("ESC installation notification not recorded as sent.");
  else if (!f.esc.installStart) ew.push("No installation start recorded, so the 24-hour rule can't be checked.");
  else if (Date.parse(f.esc.sentAt) > Date.parse(f.esc.installStart) - DAY) ew.push("ESC notice was sent less than 24 hours before the installation started.");
  items.push(item("esc_notice", "ESC installation notice", ew, f.esc.sentAt ? `Sent ${ymd(f.esc.sentAt)}` : null, { label: "Install card · Registry block", card: "install" }));
  // 8. Owner ESC consent (owner + AP ≥24h before).
  items.push(item("consent", "Owner ESC consent", f.consentBlockers, f.consentBlockers.length ? null : "Owner and AP signed ≥24h before the start", { label: "Install card · owner consent", card: "install" }));
  // 9. Warranty copy sent (G1 / decision 321).
  items.push(item("warranty", "Product warranty sent to the owner", f.warranty.providedAt ? [] : f.warranty.productsNotOnFile.length ? f.warranty.productsNotOnFile.map((p) => `Warranty copy for ${p} not on file.`) : ["Warranty copy not recorded as sent."], f.warranty.providedAt ? `Sent ${ymd(f.warranty.providedAt)}` : null, { label: "Job file · warranty", card: "final-check" }));
  // 10. VEEC assignment signatures in order.
  items.push(item("veec_assignment", "VEEC assignment signed in order (installer → AP → owner)", veecOrderProblems(f.veec), f.veec.consumerSignedAt ? `Owner signed ${ymd(f.veec.consumerSignedAt)}` : null, { label: "Final check · VEEC form", card: "final-check" }));
  // 11. Payments: the one installation invoice paid in full.
  const pay: string[] = [];
  if (!f.payments) pay.push("No installation invoice found.");
  else if (f.payments.totalPaid + 0.005 < f.payments.totalIncGst) pay.push(`${aud(f.payments.totalIncGst - f.payments.totalPaid)} still owing on the invoice.`);
  items.push(item("payments", "Paid in full", pay, f.payments ? `${aud(f.payments.totalPaid)} of ${aud(f.payments.totalIncGst)} paid` : null, { label: "Money", card: "money" }));
  // 12. Every other existing guard for Ready for VEEC not already listed above (never hidden).
  const listed = new Set(items.flatMap((i) => i.why));
  if (items.some((i) => i.key === "veec_assignment" && i.state === "fail")) listed.add(ASSIGNMENT_VEEC_BLOCKER);
  const other = [...new Set(f.guards)].filter((g) => !listed.has(g));
  items.push(item("other", "Other workflow checks for Ready for VEEC", other, other.length ? null : "No other guard is holding the job", { label: "Final check · compliance", card: "final-check" }));
  return items;
}

/** Approve is enabled only when the job is at Final check and every item passes (or is not needed). */
export function finalCheckReady(stage: string | null, items: FinalCheckItem[]): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (stage !== "ap_review") reasons.push("This job is not waiting for Final check.");
  for (const i of items) if (i.state === "fail") reasons.push(`${i.label}: ${i.why.join(" ")}`);
  return { ready: !reasons.length, reasons };
}
