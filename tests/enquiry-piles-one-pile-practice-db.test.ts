import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// FIRM RULE (Jo, 21 Oct): a job is only ever in ONE pile.
const db = new PGlite();
const sql = readFileSync(new URL('../docs/pending-migrations/0217_enquiry_piles_exclusive.sql', import.meta.url), 'utf8');
const PILES = ['photos', 'offered_spot', 'insulation_requested', 'needs_attention', 'spot_saved', 'ineligible', 'removed'];
async function page(view: string, search = '') {
  const r = await db.query<{ result: { ids: string[]; total: number; counts: Record<string, number> } }>('SELECT office_enquiry_page($1,$2,1) result', [view, search]);
  return r.rows[0]!.result;
}
beforeAll(async () => {
  await db.exec(`CREATE TABLE office_enquiry_index(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text DEFAULT 'base44', channel text DEFAULT 'hivic_sourced',
    office_bucket text DEFAULT 'enquiry', enquiry_status text DEFAULT 'needs_attention', media_to_review boolean DEFAULT false,
    spot_offered boolean DEFAULT false, spot_saved boolean DEFAULT false, owner_progressed boolean DEFAULT false,
    removed boolean DEFAULT false, deleted_at timestamptz, contact_rank integer DEFAULT 1, needs_first_response boolean DEFAULT false,
    response_state text DEFAULT 'none', latest_attempt_status text, created_at timestamptz DEFAULT now(),
    owner_name text, owner_email text, owner_phone text, property_address text, job_number text, external_enquiry_id text);
    INSERT INTO office_enquiry_index(job_number,enquiry_status,media_to_review) VALUES
      ('uploaded','insulation_requested',true),('waiting','insulation_requested',false),('attn-media','needs_attention',true),('attn','needs_attention',false);
    INSERT INTO office_enquiry_index(job_number,enquiry_status,spot_offered) VALUES ('offered','offered_spot',true);
    INSERT INTO office_enquiry_index(job_number,enquiry_status,spot_saved,office_bucket) VALUES ('saved','spot_saved',true,'active');`);
  await db.exec(sql); await db.exec(sql);
});
afterAll(async () => { await db.close(); });

test('owner upload leaves Insulation requested and shows only in Photos/videos to check', async () => {
  expect((await page('photos', 'uploaded')).total).toBe(1);
  expect((await page('insulation_requested', 'uploaded')).total).toBe(0);
  expect((await page('insulation_requested', 'waiting')).total).toBe(1);
});
test('no job is in two piles, and pile counts add up to the jobs shown', async () => {
  const seen = new Map<string, string>();
  for (const p of PILES) for (const id of (await page(p)).ids) {
    expect(seen.has(id) ? `${id} in ${seen.get(id)} and ${p}` : '').toBe('');
    seen.set(id, p);
  }
  const c = (await page('all')).counts;
  expect(c.photos).toBe(2); expect(c.insulation_requested).toBe(1); expect(c.needs_attention).toBe(1); expect(c.offered_spot).toBe(1);
});
