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