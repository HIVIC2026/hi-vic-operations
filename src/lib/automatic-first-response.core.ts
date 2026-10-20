export function automaticFirstResponseStatus(enabled: boolean, activatedAt: string | null) {
  if (!enabled) return { on: false, reason: 'Automatic selection is disabled.' };
  if (!activatedAt) return { on: false, reason: 'Not activated. No automatic first responses will be sent.' };
  if (!Number.isFinite(Date.parse(activatedAt))) return { on: false, reason: 'Activation date is invalid.' };
  return { on: true, reason: 'Activated; all delivery safeguards still apply.' };
}

export const FIRST_RESPONSE_PURPOSES = ['existing_leads_launch_v1', 'step3_estimate', 'insulation_video_request', 'preliminary_ineligible'] as const;
export function automaticFirstResponseBlocker(facts: { activatedAt: string | null; createdAt: string | null; held: boolean; confirmed: boolean }) {
  if (!facts.activatedAt || !Number.isFinite(Date.parse(facts.activatedAt))) return 'Not activated';
  if (!facts.createdAt || !Number.isFinite(Date.parse(facts.createdAt))) return 'Enquiry creation date unavailable';
  if (Date.parse(facts.createdAt) < Date.parse(facts.activatedAt)) return 'Enquiry predates activation';
  if (facts.held) return 'Backlog held for explicit Office release';
  if (facts.confirmed) return 'Confirmed first response already sent';
  return null;
}
/** Statuses that prove (or may prove) the homeowner already got an email from this job. Failed attempts stay retryable. */
export const ANSWERED_SEND_STATUSES = ['sent', 'delivered'] as const;
export const UNCERTAIN_SEND_STATUSES = ['sending', 'queued', 'delivered_unrecorded', 'sending_unknown'] as const;
/** Any prior own-job send of ANY purpose, an uncertain attempt, or customer-visible outbound correspondence blocks an
 *  automatic initial response. Read failures block. */
export function priorInitialResponseBlocker(f: { sendStatuses: string[] | null; customerOutboundEmails: number | null }): string | null {
  if (f.sendStatuses === null || f.customerOutboundEmails === null) return 'Could not verify first-response safety facts.';
  if (f.sendStatuses.some(s => (ANSWERED_SEND_STATUSES as readonly string[]).includes(s))) return 'Confirmed first response already sent';
  if (f.sendStatuses.some(s => (UNCERTAIN_SEND_STATUSES as readonly string[]).includes(s))) return 'Earlier email outcome pending or uncertain — never resent automatically';
  if (f.customerOutboundEmails > 0) return 'Customer correspondence already recorded on this job';
  return null;
}
export const EXPLICITLY_EXCLUDED_JOBS = ['HV-2566', 'HV-2648'] as const;

/** Durable retry window for automatic initial responses: post-activation, at most 14 days old, still genuinely unanswered. */
export const SWEEP_MAX_AGE_MS = 14 * 86_400_000;
export function sweepEligible(row: { created_at: string | null; needs_first_response: boolean | null; office_bucket: string | null; source: string | null; job_number: string | null }, activatedAt: string | null, now = Date.now()): boolean {
  const created = Date.parse(row.created_at ?? ''), active = Date.parse(activatedAt ?? '');
  if (!Number.isFinite(created) || !Number.isFinite(active)) return false;
  if ((EXPLICITLY_EXCLUDED_JOBS as readonly string[]).includes(row.job_number ?? '')) return false;
  return row.source === 'base44' && row.office_bucket === 'enquiry' && row.needs_first_response === true && created >= active && now - created <= SWEEP_MAX_AGE_MS;
}
