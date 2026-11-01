import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Jo 1 Nov 2026: a duplicate enquiry must never hide the owner's saved spot (HV-1374, HV-1156, HV-1339).
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const view = (sql: string) => sql.slice(sql.indexOf('CREATE OR REPLACE VIEW public.office_enquiry_index'));
const NEXT = 'docs/pending-migrations/0232_duplicate_keeps_saved_spot.sql';
const BEFORE = 'docs/pending-migrations/0228_address_request_not_first_response.sql';

describe('pending migration 0232: only the duplicate ranking changes', () => {
  test('same as 0228 except the contact_rank ORDER BY; rollback is 0228', () => {
    const next = view(read(NEXT));
    const old = 'ORDER BY base.created_at DESC, base.id DESC)';
    const neu = 'ORDER BY base.spot_saved DESC, base.owner_progressed DESC, base.created_at DESC, base.id DESC)';
    expect(next.split(neu).length - 1).toBe(1);
    expect(next.replace(neu, old)).toBe(view(read(BEFORE)));
    expect(view(read('docs/pending-migrations/0232_duplicate_keeps_saved_spot.rollback.sql'))).toBe(view(read(BEFORE)));
  });
});

const db = new PGlite();
const SCHEMA = `
  CREATE TYPE booking_status AS ENUM ('provisional','confirmed','completed','cancelled');
  CREATE TYPE quote_status AS ENUM ('draft','sent','accepted','declined');
  CREATE TABLE owners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text);
  CREATE TABLE properties(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), address_line text, suburb text, state text, postcode text);
  CREATE TABLE jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_number text, external_enquiry_id text,
    stage text DEFAULT 'preliminary_estimate_ready', source text DEFAULT 'base44', channel text DEFAULT 'hivic_sourced',
    created_at timestamptz, eligibility_set_at timestamptz, eligibility_outcome text, deleted_at timestamptz,
    qa_archived_at timestamptz, owner_id uuid, property_id uuid);
  CREATE TABLE workflow_events(id uuid DEFAULT gen_random_uuid(), job_id uuid, event_type text);
  CREATE TABLE customer_email_sends(id uuid DEFAULT gen_random_uuid(), job_id uuid, status text, purpose text,
    idempotency_key text, created_at timestamptz DEFAULT now(), sent_at timestamptz);
  CREATE TABLE lead_campaign_responses(job_id uuid, spot_saved_at timestamptz, opted_out_at timestamptz);
  CREATE TABLE customer_engagement_events(id uuid DEFAULT gen_random_uuid(), job_id uuid, event_type text, source text,
    metadata jsonb, occurred_at timestamptz);
  CREATE TABLE documents(job_id uuid, kind text, storage_path text, created_at timestamptz);
  CREATE TABLE evidence_files(job_id uuid, storage_path text, uploaded_at timestamptz);
  CREATE TABLE ready_check_acceptances(job_id uuid);
  CREATE TABLE ready_check_windows(job_id uuid, status text);
  CREATE TABLE bookings(job_id uuid, status booking_status);
  CREATE TABLE quotes(job_id uuid, status quote_status);
  CREATE TABLE job_communications(job_id uuid, direction text, channel text, visibility text, sent_at timestamptz,
    source_event text, source_reference text, delivery_status text);`;

async function job(n: string, email: string, addr: string, created: string) {
  const o = (await db.query<{ id: string }>('INSERT INTO owners(full_name,email) VALUES ($1,$2) RETURNING id', [n, email])).rows[0]!.id;
  const p = (await db.query<{ id: string }>("INSERT INTO properties(address_line,suburb,state,postcode) VALUES ($1,'Town','VIC','3000') RETURNING id", [addr])).rows[0]!.id;
  return (await db.query<{ id: string }>('INSERT INTO jobs(job_number,created_at,owner_id,property_id) VALUES ($1,$2,$3,$4) RETURNING id', [n, created, o, p])).rows[0]!.id;
}
async function row(n: string) {
  return (await db.query<{ contact_rank: number; office_bucket: string; enquiry_status: string }>(
    'SELECT contact_rank, office_bucket, enquiry_status FROM office_enquiry_index WHERE job_number=$1', [n])).rows[0]!;
}

beforeAll(async () => {
  await db.exec(SCHEMA);
  await db.exec(read(NEXT));
  // Saved a spot on the first job, then sent the form again (HV-1374 / HV-1377 shape).
  const saved = await job('saved-old', 'a@x.au', '1 Main St', '2026-10-03T05:10:00Z');
  await job('saved-new', 'a@x.au', '1 Main St', '2026-10-03T06:00:00Z');
  await db.query('INSERT INTO lead_campaign_responses(job_id,spot_saved_at) VALUES ($1, now())', [saved]);
  // Accepted a Ready Check on the first job, no saved spot.
  const prog = await job('prog-old', 'b@x.au', '2 Main St', '2026-10-01T00:00:00Z');
  await job('prog-new', 'b@x.au', '2 Main St', '2026-10-02T00:00:00Z');
  await db.query('INSERT INTO ready_check_acceptances(job_id) VALUES ($1)', [prog]);
  // Neither moved: the newest stays, as before.
  await job('plain-old', 'c@x.au', '3 Main St', '2026-10-01T00:00:00Z');
  await job('plain-new', 'c@x.au', '3 Main St', '2026-10-02T00:00:00Z');
});
afterAll(async () => { await db.close(); });

describe('duplicate enquiries on the practice database', () => {
  test('the job with the saved spot is kept and shown as Spot saved; the newer one is the duplicate', async () => {
    expect(await row('saved-old')).toEqual({ contact_rank: 1, office_bucket: 'active', enquiry_status: 'spot_saved' });
    expect(await row('saved-new')).toMatchObject({ contact_rank: 2, office_bucket: 'closed' });
  });
  test('with no saved spot, the job the owner moved forward is kept', async () => {
    expect(await row('prog-old')).toMatchObject({ contact_rank: 1, office_bucket: 'active' });
    expect(await row('prog-new')).toMatchObject({ contact_rank: 2, office_bucket: 'closed' });
  });
  test('when neither moved, the newest is kept as before', async () => {
    expect(await row('plain-new')).toMatchObject({ contact_rank: 1, office_bucket: 'enquiry' });
    expect(await row('plain-old')).toMatchObject({ contact_rank: 2, office_bucket: 'closed' });
  });
});
