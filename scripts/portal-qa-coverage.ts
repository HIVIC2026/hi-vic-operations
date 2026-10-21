// Source-only checklist: never discovers credentials, tokens, jobs or mutations.
export type RouteCoverage = { path: string; persona: string; fixture: string | null };
export function uiRouteInventory(source: string): RouteCoverage[] {
  const section = source.split('export interface FileRoutesByFullPath {')[1]?.split('\n}')[0] ?? '';
  const paths = [...section.matchAll(/^\s+'([^']+)':/gm)].map(m => m[1]).filter((path): path is string => Boolean(path));
  return [...new Set(paths.filter(p => !p.startsWith('/api/') && !p.startsWith('/t/')).map(p => p === '/' ? p : p.replace(/\/$/, '')))].map(path => ({
    path, persona: path.startsWith('/admin') ? 'office' : path.startsWith('/owner') ? 'owner' : path.startsWith('/field') || path.startsWith('/partner') || path === '/portal' || path === '/home' ? 'installer' : 'public',
    fixture: path.includes('$') ? 'exact isolated TEST job/offer/token with read-side-effect preflight' : null,
  }));
}
export const READ_ONLY_PATHS = [
  '/', '/calculator', '/privacy', '/auth',
  '/admin/jobs/active', '/admin/jobs/closed', '/admin/enquiries', '/admin/enquiry-groups',
  '/admin/board', '/admin/pipeline', '/admin/operations', '/admin/operations-preview',
  '/admin/partners-overview', '/admin/businesses', '/admin/workers', '/admin/templates',
  '/admin/quotes', '/admin/money', '/admin/ap-queue', '/admin/owner-paperwork', '/admin/veec',
  '/field', '/field/money', '/field/business', '/field/business/details', '/field/business/insurance',
  '/field/business/rates', '/field/business/bank', '/field/business/agreement', '/field/business/team',
  '/partner', '/partner/add', '/partner/import', '/partner/bulk-import', '/partner/payments', '/partner/workers',
  '/admin', '/admin/campaign-emails', '/admin/communications', '/admin/compliance', '/admin/coverage',
  '/admin/deleted', '/admin/electrician-rates', '/admin/hot-leads', '/admin/interests', '/admin/jobs',
  '/admin/launch-campaign', '/admin/list', '/admin/needs-me', '/admin/partners', '/admin/pricing',
  '/admin/ready-check', '/admin/save-my-spot-rules', '/admin/team-ups', '/admin/test-centre',
  '/admin/today', '/admin/todo', '/admin/users', '/field/setup', '/field/welcome', '/home', '/portal',
  '/partner/profile', '/campaign-preview', '/electrician-onboarding', '/installer-onboarding',
  '/installer-preview', '/reset-password', '/step3-email-preview',
];
export function uncoveredReason(route: RouteCoverage, attempted: Set<string>): string | null {
  if (attempted.has(route.path)) return null;
  return route.fixture ?? 'not visited by this bounded run; no interaction/flow coverage implied';
}
export function readyCheckBookingOutcome(booked: boolean, readback: { stage?: string | null; next_action?: string | null } | null, error?: string, windowProof?: { verified: boolean; detail: string }) {
  if (!booked) return { status: 'not_run' as const, detail: `booking not completed: ${error ?? 'fixture/gate unavailable'}` };
  if (readback?.stage !== 'ready_check_scheduled' || readback.next_action !== 'Ready Check booked') return { status: 'failed' as const, detail: 'booking call returned but scheduled stage/next action not read back' };
  if (!windowProof) return { status: 'not_run' as const, detail: 'scheduled UI/state alone: persisted allowed-window and zero-side-effect readback missing' };
  if (!windowProof.verified) return { status: 'failed' as const, detail: windowProof.detail };
  return { status: 'passed' as const, detail: 'TEST booking completed and scheduled state read back' };
}