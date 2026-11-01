// Decision 370 (Jo, 25 Oct 2026 — "automate as much as possible; very little office work"): our AP part of the ESC
// Owner's Consent Form (Section 3 Part A details + Part B declaration, decision 123) is applied AUTOMATICALLY once the
// owner has signed and every existing check passes — the same way decision 271 applies the VEEC assignment Part A
// (veec-ap-auto.core.ts). PURE: given the facts, decide sign / hold / skip. The server (`consent-ap-auto.server.ts`)
// gathers the facts and signs through the ONE existing path (`confirmApConsent`), so the timing rules (consent complete
// ≥24h before the install start, current booking, four Section 2 ticks) and the O63 executed-copy email are unchanged.
// The office Sign stays as the fallback; Needs me shows a row only when the signature has been held >24h (or the
// 24-hours-before-start deadline is less than a day away), with the reason.
import { AP_DETAILS } from "./veec-assignment-form.core";
import { OFFICE_REPLY_TO } from "./office-email.core";
import { allDeclarationsTicked, apConsentBlockers, isEscTemplateVersion, latestConsentAt, splitFullName, type ApRep, type OwnerDeclarations } from "./consent.core";

/** Append-only audit event written beside the existing `esc_consent_valid` when the AP part signs itself. */
export const CONSENT_AP_AUTO_EVENT = "consent_ap_signed_auto";
/** Internal event recorded when the automatic signature is held (once per distinct set of reasons). */
export const CONSENT_AP_AUTO_HELD_EVENT = "consent_ap_auto_held";
export const CONSENT_AP_AUTO_METHOD = "automatic";
export const CONSENT_AP_MANUAL_METHOD = "manual";
/** Needs me shows a row once the automatic signature has waited this long after the owner signed… */
export const CONSENT_AP_HELD_ALERT_MS = 24 * 3600_000;
/** …or as soon as the consent deadline (24h before the install start) is closer than this. */
export const CONSENT_AP_DEADLINE_ALERT_MS = 24 * 3600_000;

/**
 * Section 3 Part A details for the automatic signature: the AP representative named on the forms (the same person
 * decision 271 signs the VEEC assignment as), the office phone on the VEEC form and the office email. Null when no
 * representative is configured (→ hold, never a blank signature).
 */
export function consentAutoApRep(details: { fullName: string | null; phone: string | null } = AP_DETAILS, email: string | null = OFFICE_REPLY_TO): ApRep | null {
  const n = splitFullName(details.fullName);
  if (!n.first || !n.last) return null;
  return { first_name: n.first, last_name: n.last, role: "AP representative", phone: details.phone ?? null, email };
}

export type ConsentApAutoFacts = {
  /** Current owner_esc_consents status (null = no consent prepared). */
  status: string | null;
  ownerSignedAt: string | null;
  apSignedAt: string | null;
  /** Start on the consent snapshot. */
  scheduledStart: string | null;
  /** Start of the CURRENT confirmed installation booking (a different start = stale consent; never signed). */
  bookingStart: string | null;
  templateVersion: string | null;
  ownerDeclarations: OwnerDeclarations | null;
  nowIso: string;
  rep: ApRep | null;
};

export type ConsentApAutoDecision =
  | { action: "sign"; rep: ApRep }
  | { action: "hold"; reasons: string[] }
  | { action: "skip"; reason: string };

/** Sign when the owner has signed and nothing blocks the AP part; hold with every reason otherwise; skip when there is nothing to do. */
export function decideConsentApAutoSignature(f: ConsentApAutoFacts): ConsentApAutoDecision {
  if (!f.status) return { action: "skip", reason: "no owner consent prepared yet" };
  if (f.apSignedAt) return { action: "skip", reason: "AP representative has already signed" };
  if (!f.ownerSignedAt) return { action: "skip", reason: "owner has not signed yet" };
  if (f.status !== "awaiting_ap") return { action: "skip", reason: `consent is ${f.status.replace(/_/g, " ")}` };
  const reasons: string[] = [];
  if (isEscTemplateVersion(f.templateVersion) && !allDeclarationsTicked(f.ownerDeclarations)) reasons.push("The owner's four Section 2 declarations are not all recorded.");
  if (!f.rep) reasons.push("No AP representative is configured to sign Section 3.");
  // The existing manual rules, unchanged: status, ≥24h before start, Part B declaration, representative details.
  {
    const rep = f.rep ?? { first_name: "", last_name: "", role: "", phone: null, email: null };
    for (const b of apConsentBlockers({ status: f.status, scheduledStart: f.bookingStart, nowIso: f.nowIso, apRepName: `${rep.first_name} ${rep.last_name}`.trim(), purposeExplained: true, templateVersion: f.templateVersion, apRep: f.rep }))
      if (!f.rep && /AP representative/.test(b)) continue; // already said once above
      else reasons.push(b);
  }
  return reasons.length || !f.rep ? { action: "hold", reasons: reasons.length ? reasons : ["No AP representative is configured to sign Section 3."] } : { action: "sign", rep: f.rep };
}

/** Needs me: alert when held >24h after the owner signed, or when the consent deadline (24h before start) is under a day away. */
export function consentApHoldAlert(x: { ownerSignedAt: string | null; scheduledStart: string | null; now: number; reasons: string[] }): { alert: boolean; heldForMs: number; dueAt: string | null } {
  const dueAt = x.scheduledStart ? latestConsentAt(x.scheduledStart) : null;
  if (!x.ownerSignedAt || !x.reasons.length) return { alert: false, heldForMs: 0, dueAt };
  const heldForMs = Math.max(0, x.now - Date.parse(x.ownerSignedAt));
  const deadlineClose = dueAt != null && Date.parse(dueAt) - x.now <= CONSENT_AP_DEADLINE_ALERT_MS;
  return { alert: heldForMs > CONSENT_AP_HELD_ALERT_MS || deadlineClose, heldForMs, dueAt };
}

/** True when a new held event should be recorded (reasons changed since the last one). */
export function consentHoldReasonsChanged(previous: string[] | null, current: string[]): boolean {
  if (!previous) return true;
  return previous.length !== current.length || previous.some((r, i) => r !== current[i]);
}

export const consentApAutoSignedSummary = (name: string) => `ESC owner consent Section 3 (AP part) signed automatically as ${name} (AP representative) — owner signed and every check passed (decision 370)`;
export const consentApAutoHeldSummary = (reasons: string[]) => `ESC owner consent AP part not signed automatically yet: ${reasons.join(" ")}`;
