// COM-04 test-recipient isolation boundary (P1-R3-S102). Defence-in-depth so an approved test run can
// NEVER reach a real customer address. Pure: no I/O, no delivery.
//
// ENVIRONMENT MODEL (owner clarification, PART 1):
//   - Production is an EXPLICIT designation: HIVIC_COM04_ENV=production. Only then is the boundary
//     inactive and every real recipient is allowed (unchanged production behaviour).
//   - ANYTHING else (unset, "nonproduction", "test", "staging", ...) is treated as NON-PRODUCTION and
//     the boundary FAILS CLOSED: a valid, non-empty allow-list is REQUIRED, and only allow-listed (or
//     test-shaped) addresses may be contacted. A missing/empty/invalid allow-list blocks EVERY send.
//   - Production therefore never depends on a "silently missing variable" to disable restrictions:
//     it must opt in explicitly; forgetting to do so fails CLOSED (blocks sends), which is the safe
//     direction. This is the whole point — a real customer must never be emailed merely because the
//     allow-list variable happens to be absent.
//
// The boundary validates the FINAL resolved recipient immediately before the provider call. It does
// NOT bypass itself merely because job.source === "qa_test": qa_test sends are re-routed to Jo's inbox
// by the TEST sender (test-send.core.ts) BEFORE any provider contact, so a qa_test job can never reach
// a real customer through this path, and the real (non-qa_test) send path is always validated here.
//
// S99-R6: "real Save-my-spot sends have no recipient allow-list." This closes that gap for approved
// test/staging WITHOUT a new DB column, a migration, or any production write.
import { isTestRecipient } from "./emailsafety.core";

export const COMMS_ENV_VAR = "HIVIC_COM04_ENV";
export const TEST_RECIPIENT_ENV = "HIVIC_COM04_TEST_RECIPIENTS";

export type CommsEnvironment = "production" | "nonproduction";
export type TestRecipientDecision =
  | { status: "inactive"; restricted: false } // production: boundary off, recipient allowed
  | { status: "allowed"; restricted: true } //   non-production: recipient permitted
  | { status: "blocked"; restricted: true; reason: string }; // non-production: fail closed

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Explicit production opt-in; everything else (including unset) is non-production (fail closed). */
export function commsEnvironment(env: string | undefined | null = process.env[COMMS_ENV_VAR]): CommsEnvironment {
  return (env ?? "").trim().toLowerCase() === "production" ? "production" : "nonproduction";
}

/** comma-separated, trimmed, lower-cased, non-empty entries. */
export function parseTestRecipientAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** true if the allow-list contains at least one malformed (non-email) entry. */
export function allowlistIsInvalid(entries: string[]): boolean {
  return entries.some((e) => !EMAIL_SHAPE.test(e));
}

export type BoundaryOpts = {
  /** override for HIVIC_COM04_ENV (tests inject). */
  env?: string;
  /** override for HIVIC_COM04_TEST_RECIPIENTS (tests inject). */
  allowlist?: string;
};

/**
 * Decide whether `to` may be contacted. `jobSource` is accepted for context/logging only and is NOT
 * used to bypass the boundary. Reads process.env by default; inject via opts for tests.
 *
 * Fail-closed rule (owner PART 1): in non-production a REAL recipient requires a valid, non-empty
 * allow-list — a real customer is never permitted merely because the allow-list variable is absent.
 * Provably-synthetic addresses (RFC-reserved test domains, `qa…`, `+qa@`, mailinator) are NOT real
 * customers and remain permitted without an allow-list, so legitimate synthetic test flows keep
 * working while no real customer can ever be reached.
 */
export function testRecipientBoundary(
  to: string | null | undefined,
  jobSource: string | null | undefined,
  opts: BoundaryOpts = {},
): TestRecipientDecision {
  void jobSource;
  if (commsEnvironment(opts.env ?? process.env[COMMS_ENV_VAR]) === "production") return { status: "inactive", restricted: false };

  const entries = parseTestRecipientAllowlist(opts.allowlist ?? process.env[TEST_RECIPIENT_ENV]);
  const hasInvalid = allowlistIsInvalid(entries);
  const norm = (to ?? "").trim().toLowerCase();
  if (!norm) return { status: "blocked", restricted: true, reason: "Non-production test boundary is active and no recipient was resolved." };
  // Provably-synthetic addresses are never real customers — permitted even without an allow-list.
  if (isTestRecipient(norm)) return { status: "allowed", restricted: true };
  // From here the recipient is a REAL address: fail closed unless it is on a valid allow-list.
  if (hasInvalid) return { status: "blocked", restricted: true, reason: `Non-production test boundary is active but ${TEST_RECIPIENT_ENV} contains an invalid address. Fix the allow-list before sending.` };
  if (entries.length === 0) return { status: "blocked", restricted: true, reason: `Non-production test boundary is active and ${TEST_RECIPIENT_ENV} is missing or empty. A real recipient requires an approved allow-list (or set ${COMMS_ENV_VAR}=production for production).` };
  if (entries.includes(norm)) return { status: "allowed", restricted: true };
  return { status: "blocked", restricted: true, reason: `Non-production test boundary is active: ${norm} is not on the approved test-recipient list (${TEST_RECIPIENT_ENV}).` };
}

/** Convenience: true only when the decision permits the send. */
export const boundaryAllows = (d: TestRecipientDecision) => d.status !== "blocked";
