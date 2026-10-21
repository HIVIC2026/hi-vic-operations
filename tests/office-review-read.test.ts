import { expect, mock, test } from 'bun:test';
import { OFFICE_PENDING_PHOTOS_FILTER, OFFICE_REVIEW_FILTER, officeReviewSearch } from '../src/lib/office-review.core';
import { createClient } from '@supabase/supabase-js';

// Exercise the real SDK filter grammar through its serialized request; no hosted writes.
const captured: URL[] = [];
const client = createClient('https://practice.invalid', 'practice-key', { global: { fetch: async input => {
  captured.push(new URL(String(input)));
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
} } });

test('combined review is one OR branch with shared offer/saved/closed exclusions', async () => {
  await client.from('office_enquiry_index').select('id', { count: 'exact' }).or(OFFICE_REVIEW_FILTER);
  const url = captured.at(-1);
  expect(url?.searchParams.get('or')).toBe(`(${OFFICE_REVIEW_FILTER})`);
  expect(OFFICE_REVIEW_FILTER).toContain('or(media_to_review.eq.true,and(enquiry_status.eq.needs_attention,media_to_review.eq.false))');
  for (const filter of [OFFICE_REVIEW_FILTER, OFFICE_PENDING_PHOTOS_FILTER]) {
    for (const exclusion of ['spot_offered.eq.false', 'enquiry_status.not.in.(offered_spot,spot_saved,ineligible)', 'spot_saved.eq.false', 'removed.eq.false', 'deleted_at.is.null', 'owner_progressed.eq.false']) expect(filter).toContain(exclusion);
  }
});
test('literal search widens across words and escapes wildcard and quoted input', async () => {
  expect(officeReviewSearch('   ')).toBeNull();
  const search = officeReviewSearch('HV-1234 Smith');
  expect(search?.split(',')).toHaveLength(12);
  expect(search).toContain('job_number.ilike."%hv-1234%"');
  expect(officeReviewSearch('50%_')).toContain('50\\\\%\\\\_');
  await client.from('office_enquiry_index').select('id').or(OFFICE_REVIEW_FILTER).or(search ?? '');
  expect(captured.at(-1)?.searchParams.getAll('or')).toEqual([`(${OFFICE_REVIEW_FILTER})`, `(${search})`]);
});