import { beforeEach, expect, mock, test } from 'bun:test';
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from(table: string) {
  const filters: [string, unknown][] = []; let ordered = false;
  const result = () => {
    const rows = (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
    if (ordered) rows.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    return { data: rows, error: null };
  };
  const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, in: () => query,
    order: () => { ordered = true; return query; }, limit: () => query,
    maybeSingle: async () => ({ data: result().data[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return query;
} } }));
mock.module('../src/lib/workflow.server', () => ({ logEvent: async () => {}, WorkflowError: Error }));
mock.module('../src/lib/group-b-media.server', () => ({ groupBMediaForJob: async () => ({ received: true, excluded: true, uncertain: false, pendingSync: false, count: 1 }) }));
const { campaignLink, campaignPermission } = await import('../src/lib/launch-campaign.server');
const token = 'r'.repeat(43);
beforeEach(() => {
  tables = {
    customer_estimate_links: [{ id: 'link', token, job_id: 'job', purpose: 'step3_estimate', status: 'active', expires_at: new Date(Date.now() + 86_400_000).toISOString() }],
    jobs: [{ id: 'job', source: 'base44', stage: 'preliminary_estimate_ready', eligibility_outcome: 'likely_eligible', eligibility_review_required: false, eligibility_decision_source: 'admin', properties: { enrichment: { base44: { raw: { answers: { existing_insulation: 'unknown' } } } } } }],
    customer_engagement_events: [{ id: 'review', job_id: 'job', event_type: 'intake_media_reviewed', source: 'office', metadata: { outcome: 'no_insulation' }, occurred_at: '2026-10-20T10:00:00Z' }],
    owner_contact_consents: [{ job_id: 'job', consent_status: 'granted' }], lead_campaign_responses: [], customer_email_optouts: [], post_intake_work: [], workflow_events: [],
  };
});
test('reviewed no-insulation offer opens the matching customer campaign without replacing the owner answer', async () => {
  const before = JSON.stringify(tables.jobs);
  const result = await campaignLink(token);
  expect(result?.group).toBe('likely');
  expect(campaignPermission(result!, null)).toBe(true);
  expect(JSON.stringify(tables.jobs)).toBe(before);
});
test('the photo review cannot invent a likely-eligible official decision', async () => {
  tables.jobs![0]!.eligibility_outcome = 'needs_onsite_confirmation';
  expect(await campaignLink(token)).toBeNull();
});
test('a later unclear review removes the offer permission', async () => {
  tables.customer_engagement_events!.push({ id: 'later', job_id: 'job', event_type: 'intake_media_reviewed', source: 'office', metadata: { outcome: 'unclear' }, occurred_at: '2026-10-20T11:00:00Z' });
  const result = await campaignLink(token);
  expect(result?.group).toBe('onsite'); expect(campaignPermission(result!, null)).toBe(false);
});
