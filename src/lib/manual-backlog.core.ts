// Manually-approved enquiry backlog release (ENQ_00 reconcile -> ENQ_01 enqueue). Pure; tested in
// tests/manual-backlog-release.test.ts.
//
// ENQ_01_ENQUEUE_SAFE.sql marks every row it writes with BOTH markers below. Only a post-intake worker item that
// carries both markers gets the trusted context, and the context is a module-private Symbol: it cannot be produced
// from JSON, a form, a URL or any server-function input, so no client can switch the bypass on.
//
// The trusted context relaxes ONLY:
//   - the Office automatic Save-my-spot activation date / enquiry-date window (automaticSaveSpotGate),
//   - the "original enquiry must be proven new" hold on the labelled 150 m² first reply (T1),
//   - the jobs_created_after / 14-day backlog timing suppression on the one-time ineligible reply (T7).
// Consent, opt-out, bounce, test recipients, email validity, official eligibility, stage, media/review gates,
// duplicate/idempotency, pricing validity, service coverage and the global switches are never relaxed.
export const MANUAL_BACKLOG_REASON = "ENQUIRY_BACKLOG_MANUAL";
export const MANUAL_BACKLOG_FACTS_VERSION = "enquiry-backlog-manual";

const MANUAL_BACKLOG_TRUST: unique symbol = Symbol("hivic.manual-backlog-release");
export type ManualBacklogTrust = typeof MANUAL_BACKLOG_TRUST;
export type LeadRouteContext = { manualBacklog?: ManualBacklogTrust };

/** The trusted context for a claimed worker item, or an empty (normal) context. */
export function routeContextForWorkItem(item: { reason: string | null | undefined; facts_version: string | null | undefined }): LeadRouteContext {
  return item.reason === MANUAL_BACKLOG_REASON && item.facts_version === MANUAL_BACKLOG_FACTS_VERSION ? { manualBacklog: MANUAL_BACKLOG_TRUST } : {};
}

/** True only for the exact Symbol issued above; strings, booleans and look-alike symbols are rejected. */
export function isManualBacklog(ctx: { manualBacklog?: unknown } | null | undefined): boolean {
  return !!ctx && ctx.manualBacklog === MANUAL_BACKLOG_TRUST;
}
