// Decision 271 (Jo, 25 Oct 2026): the AP representative's signature on Section 3 Part A of the official VEEC assignment
// form (ESC v1.1) is applied AUTOMATICALLY — no office step. Once the lead installer has signed Part B and every AP
// prerequisite is recorded (PIESA copies ≥24h, ESC notice ≥24h, warranty copy, collection notice per installer, owner
// consent valid) the portal signs as the configured AP representative. PURE: given the facts, decide sign / hold / skip.
// The server (`veec-ap-auto.server.ts`) gathers facts, writes exactly what the manual path writes plus one
// `veec_ap_signed_auto` event, and is idempotent per job. The office is told (Needs me) only when the signature has
// been held for more than 24 hours — never asked to sign.
import { AP_DETAILS } from "./veec-assignment-form.core";

/** Append-only audit event written beside the manual path's FINAL_ASSIGNMENT_SIGNED. */
export const VEEC_AP_AUTO_EVENT = "veec_ap_signed_auto";
/** Internal event recorded when the automatic signature is held (one per distinct set of reasons, never repeated each tick). */
export const VEEC_AP_AUTO_HELD_EVENT = "veec_ap_auto_held";
export const VEEC_AP_AUTO_METHOD = "automatic";
export const VEEC_AP_MANUAL_METHOD = "manual";
/** Needs me shows a row only once the automatic signature has waited this long on the installer's signature. */
export const AP_AUTO_HELD_ALERT_MS = 24 * 3600_000;

/** The configured AP representative who signs Part A automatically: the representative named on the form (Section 2 AP details). */
export const AP_AUTO_SIGNER = { name: AP_DETAILS.fullName, role: "AP representative" } as const;

export type ApAutoFacts = {
  /** Current final_veec_assignment status (null = no form yet). */
  status: string | null;
  installerSignedAt: string | null;
  apSignedAt: string | null;
  /** `apPrerequisiteBlockers` output (PIESA copies, ESC notice, warranty copy, collection notices). */
  prerequisiteBlockers: string[];
  /** `consentValidityBlockers` output for the booked installation start (owner consent valid). */
  ownerConsentBlockers: string[];
  openVariation: boolean;
  /** Configured AP representative name (null = not configured → hold). */
  signerName: string | null;
};

export type ApAutoDecision =
  | { action: "sign"; signerName: string }
  | { action: "hold"; reasons: string[] }
  | { action: "skip"; reason: string };

/** Sign when the installer has signed Part B and nothing blocks the AP declaration; hold with every reason otherwise; skip when there is nothing to do. */
export function decideApAutoSignature(f: ApAutoFacts): ApAutoDecision {
  if (!f.status) return { action: "skip", reason: "no VEEC assignment form prepared yet" };
  if (f.apSignedAt) return { action: "skip", reason: "AP representative has already signed" };
  if (!f.installerSignedAt) return { action: "skip", reason: "lead installer has not signed Part B yet" };
  if (f.status !== "awaiting_ap_signature") return { action: "skip", reason: `form is ${f.status.replace(/_/g, " ")}` };
  const reasons = [...f.prerequisiteBlockers, ...f.ownerConsentBlockers.map((b) => `Owner ESC consent: ${b}`)];
  if (f.openVariation) reasons.push("A variation is open and must be reconfirmed first.");
  const signer = f.signerName?.trim() ?? "";
  if (signer.length < 2) reasons.push("No AP representative is configured to sign Part A.");
  return reasons.length ? { action: "hold", reasons } : { action: "sign", signerName: signer };
}

/** Needs me: alert only when the automatic signature has been held for more than 24 hours since the installer signed. */
export function apAutoHoldAlert(x: { installerSignedAt: string | null; now: number; reasons: string[] }): { alert: boolean; heldForMs: number } {
  if (!x.installerSignedAt || !x.reasons.length) return { alert: false, heldForMs: 0 };
  const heldForMs = Math.max(0, x.now - Date.parse(x.installerSignedAt));
  return { alert: heldForMs > AP_AUTO_HELD_ALERT_MS, heldForMs };
}

/** True when a new held event should be recorded (reasons changed since the last one). */
export function holdReasonsChanged(previous: string[] | null, current: string[]): boolean {
  if (!previous) return true;
  return previous.length !== current.length || previous.some((r, i) => r !== current[i]);
}

export const apAutoSignedSummary = (signerName: string) => `VEEC assignment form Section 3 Part A signed automatically as ${signerName} (AP representative) — every prerequisite recorded (decision 271)`;
export const apAutoHeldSummary = (reasons: string[]) => `VEEC assignment Part A not signed automatically yet: ${reasons.join(" ")}`;
