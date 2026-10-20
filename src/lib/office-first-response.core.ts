import { isTestRecipient } from './emailsafety.core';
import { legacyExclusionReason } from './hot-leads.core';
import type { GroupBMediaState } from './group-b-media.core';
import type { EnquiryMediaDocument } from './group-b-media.core';
export type CatchupMedia = GroupBMediaState & { persistedCount?: number; readFailed?: boolean };
export type CatchupIdentity = { propertyId?: string | null; propertyKey?: string | null; enquiryId?: string | null; source?: string | null };
/** Email alone is never a property/enquiry identity. Keep unit and street numbers intact. */
export function sameCatchupEnquiry(a: CatchupIdentity, b: CatchupIdentity): boolean {
  const key = (v?: string | null) => v?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
  const ap = key(a.propertyId), ak = key(a.propertyKey), ae = key(a.enquiryId);
  return !!((ap && ap === key(b.propertyId)) || (ak && ak === key(b.propertyKey)) ||
    (ae && key(a.source) && key(a.source) === key(b.source) && ae === key(b.enquiryId)));
}
/** Persisted homeowner files only, not unresolved references or trade evidence. */
export function catchupMediaState(jobId: string, state: GroupBMediaState, files: EnquiryMediaDocument[], readFailed = false): CatchupMedia {
  const paths = new Set(files.filter(f => f.kind === 'intake_media' && f.storage_path?.startsWith(`${jobId}/intake/`) && !f.storage_path.includes('..') && (/^(image|video)\//i.test(f.mime_type ?? '') || /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)$/i.test(f.storage_path))).map(f => f.storage_path));
  return { ...state, persistedCount: paths.size, readFailed };
}
/** Explicit declarations only; arbitrary text is not proof of insulation presence. */
export function catchupInsulation(value: unknown): 'none' | 'present' | 'unknown' | null {
  if (value === true) return 'present';
  if (value === false) return 'none';
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (['none','no','n','false','no insulation','nothing','not present'].includes(text)) return 'none';
  if (['present','yes','y','true','existing','existing insulation','insulation present','has insulation'].includes(text)) return 'present';
  if (['unknown','unsure','not sure',"don't know",'dont know','do not know','maybe','n/a'].includes(text)) return 'unknown';
  return null;
}
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
export function catchupRoute(insulation: string | null, outcome: string | null, media: CatchupMedia): 'offer' | 'acknowledge' | 'request' | null {
  if (media.readFailed) return null;
  if ((insulation === 'present' || insulation === 'unknown') && (media.persistedCount ?? 0) > 0) return 'acknowledge';
  if (media.uncertain || media.pendingSync) return null;
  if (insulation === 'none') return outcome === 'likely_eligible' ? 'offer' : null;
  if (insulation !== 'present' && insulation !== 'unknown') return null;
  return media.received ? 'acknowledge' : 'request';
}