import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), 'utf8');
const forward = read('0216_photos_exclude_offered.sql');
type Page = { ids: string[]; total: number; counts: Record<string, number>; page: number; totalPages: number };
async function page(view: string, search = '', number = 1) {
  const result = await db.query<{ result: Page }>('SELECT office_enquiry_page($1,$2,$3) result', [view, search, number]);
  const row = result.rows[0];
  if (!row) throw new Error('Missing practice RPC result');
  return row.result;
}
beforeAll(async () => {
  await db.exec(`CREATE TABLE office_enquiry_index(
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text DEFAULT 'base44', channel text DEFAULT 'hivic_sourced',
    office_bucket text DEFAULT 'enquiry', enquiry_status text DEFAULT 'needs_attention', media_to_review boolean DEFAULT true,
    spot_offered boolean DEFAULT false, spot_saved boolean DEFAULT false, owner_progressed boolean DEFAULT false,
    removed boolean DEFAULT false, deleted_at timestamptz, contact_rank integer DEFAULT 1, needs_first_response boolean DEFAULT false,
    response_state text DEFAULT 'none', latest_attempt_status text, created_at timestamptz DEFAULT now(),
    owner_name text, owner_email text, owner_phone text, property_address text, job_number text, external_enquiry_id text);
    INSERT INTO office_enquiry_index(job_number) VALUES ('pending');
    INSERT INTO office_enquiry_index(job_number,spot_offered,enquiry_status) VALUES ('offered',true,'offered_spot'),('later-media',true,'needs_attention');
    INSERT INTO office_enquiry_index(job_number,spot_saved,enquiry_status) VALUES ('saved',true,'spot_saved');
    INSERT INTO office_enquiry_index(job_number,enquiry_status) VALUES ('ineligible','ineligible');
    INSERT INTO office_enquiry_index(job_number,removed) VALUES ('removed',true);
    INSERT INTO office_enquiry_index(job_number,deleted_at) VALUES ('deleted',now());
    INSERT INTO office_enquiry_index(job_number,owner_progressed) VALUES ('progressed',true);
    INSERT INTO office_enquiry_index(job_number,office_bucket) VALUES ('active','active'),('closed','closed');
    INSERT INTO office_enquiry_index(job_number,source) VALUES ('test','qa_test');
    INSERT INTO office_enquiry_index(job_number,channel) VALUES ('partner','installer_sourced');
    INSERT INTO office_enquiry_index(job_number,media_to_review,latest_attempt_status) VALUES ('failed-offer',false,'failed');`);
  await db.exec(forward);
  await db.exec(forward);
});
afterAll(async () => { await db.close(); });

test('actual offer appears in Spot offered, never pending photos; navigation count agrees', async () => {
  expect((await page('offered_spot', 'offered')).total).toBe(1);
  expect((await page('photos', 'offered')).total).toBe(0);
  expect((await page('photos', 'offered')).counts.photos).toBe(0);
});
test('new media after offer does not reopen the pending pile, even with attention status', async () => {
  expect((await page('photos', 'later-media')).total).toBe(0);
  const result = await db.query<{ media_to_review: boolean; spot_offered: boolean }>("SELECT media_to_review,spot_offered FROM office_enquiry_index WHERE job_number='later-media'");
  expect(result.rows[0]).toEqual({ media_to_review: true, spot_offered: true });
});
for (const name of ['saved', 'ineligible', 'removed', 'deleted', 'progressed', 'active', 'closed', 'test', 'partner']) {
  test(`${name} never leaks into pending photos`, async () => {
    expect((await page('photos', name)).total).toBe(0);
    expect((await page('photos', name)).counts.photos).toBe(0);
  });
}
test('unsent/failed offer does not hide genuine pending media or fabricate a sent offer', async () => {
  await db.exec("UPDATE office_enquiry_index SET media_to_review=true WHERE job_number='failed-offer'");
  expect((await page('photos', 'failed-offer')).total).toBe(1);
  expect((await page('offered_spot', 'failed-offer')).total).toBe(0);
});
test('All enquiries stays aggregate; matching row/count and pagination remain exact', async () => {
  expect((await page('all')).total).toBe(9);
  await db.exec("INSERT INTO office_enquiry_index(job_number) SELECT 'paging-'||n FROM generate_series(1,51) n");
  const first = await page('photos', 'paging');
  const second = await page('photos', 'paging', 2);
  expect(first.total).toBe(51);
  expect(first.counts.photos).toBe(51);
  expect(first.ids.length).toBe(50);
  expect(second.ids.length).toBe(1);
  expect(new Set([...first.ids,...second.ids]).size).toBe(51);
  expect(second.page).toBe(2);
});
test('rollback restores old overlap and reapply restores exclusion without altering facts', async () => {
  const before = await db.query('SELECT * FROM office_enquiry_index ORDER BY id');
  await db.exec(read('0216_photos_exclude_offered.rollback.sql'));
  expect((await page('photos', 'offered')).total).toBe(1);
  await db.exec(forward);
  expect((await page('photos', 'offered')).total).toBe(0);
  expect((await db.query('SELECT * FROM office_enquiry_index ORDER BY id')).rows).toEqual(before.rows);
});