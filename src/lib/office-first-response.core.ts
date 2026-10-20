import { isTestRecipient } from './emailsafety.core';
import { legacyExclusionReason } from './hot-leads.core';
import type { GroupBMediaState } from './group-b-media.core';
export type CatchupFacts = {
  jobNumber: string | null; bucket: string | null; needsFirstResponse: boolean;
  source: string; channel: string; stage: string; email: string | null;
  deleted: boolean; archived: boolean; removed: boolean; holdReason: string | null;
  answered: boolean; outbound: boolean; inFlight: boolean; recipientAnswered: boolean;
  consent: boolean; optedOut: boolean; suppressed: boolean; workActive: boolean;
  outcome: string | null; decisionSource: string | null; reviewRequired: boolean;
};
export function catchupBlocker(f: CatchupFacts): string | null {
  if (f.answered || f.outbound || f.recipientAnswered) return 'Already answered — no duplicate';
  if (f.inFlight) return 'Delivery pending or uncertain — do not resend';
  if (f.jobNumber === 'HV-2648' || f.jobNumber === 'HV-2566') return 'Explicitly excluded by Jo';
  const legacy = legacyExclusionReason(f.jobNumber);
  if (legacy) return legacy;
  if (f.source !== 'base44' || f.channel !== 'hivic_sourced' || isTestRecipient(f.email)) return 'Not a real website homeowner enquiry';
  if (!f.email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email)) return 'Invalid homeowner email';
  if (f.deleted || f.archived || f.removed) return 'Deleted, archived or removed';
  if (f.stage === 'on_hold' || f.holdReason?.trim()) return 'On hold';
  if (f.bucket !== 'enquiry' || !f.needsFirstResponse || !['new_enquiry', 'eligibility_review', 'preliminary_estimate_ready'].includes(f.stage)) return 'Not an unanswered enquiry';
  if (!f.consent) return 'Current contact consent missing';
  if (f.optedOut || f.suppressed) return 'Opted out or suppression event recorded';
  if (f.workActive) return 'Intake processing is active';
  if (f.reviewRequired || !['system', 'admin'].includes(f.decisionSource ?? '') || !['likely_eligible', 'needs_onsite_confirmation'].includes(f.outcome ?? '')) return 'Eligibility requires Office decision';
  return null;
}
export function catchupRoute(insulation: string | null, outcome: string | null, media: GroupBMediaState): 'offer' | 'acknowledge' | 'request' | null {
  if (media.uncertain || media.pendingSync) return null;
  if (insulation === 'none') return outcome === 'likely_eligible' ? 'offer' : null;
  if (insulation !== 'present' && insulation !== 'unknown') return null;
  return media.received ? 'acknowledge' : 'request';
}