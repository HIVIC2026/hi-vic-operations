// Practice database (PGlite) proof for 0215: unreviewed-photo enquiries leave Office review and stay in Photos to review.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`CREATE ROLE service_role; CREATE TABLE office_enquiry_index(id uuid primary key, source text, channel text, office_bucket text, enquiry_status text,
    media_to_review boolean, needs_first_response boolean, spot_saved boolean, removed boolean, deleted_at timestamptz, contact_rank int, response_state text,
    latest_attempt_status text, created_at timestamptz default now(), owner_name text, owner_email text, owner_phone text, property_address text, job_number text, external_enquiry_id text);
    INSERT INTO office_enquiry_index(id,source,channel,office_bucket,enquiry_status,media_to_review,needs_first_response,spot_saved,removed,contact_rank,response_state) VALUES
    (gen_random_uuid(),'base44','hivic_sourced','enquiry','needs_attention',true,false,false,false,1,'none'),
    (gen_random_uuid(),'base44','hivic_sourced','enquiry','needs_attention',true,false,false,false,1,'none'),
    (gen_random_uuid(),'base44','hivic_sourced','enquiry','needs_attention',false,false,false,false,1,'none'),
    (gen_random_uuid(),'base44','hivic_sourced','enquiry','offered_spot',true,false,false,false,1,'none');`);
  await db.exec(read("0215_office_review_excludes_photos.rollback.sql"));
  await db.exec(read("0215_office_review_excludes_photos.sql"));
  await db.exec(read("0215_office_review_excludes_photos.sql"));
});
afterAll(async () => { await db.close(); });
const page = async (v: string) => (await db.query<{ r: any }>(`SELECT office_enquiry_page($1,'',1) r`, [v])).rows[0]!.r;
test("Office review excludes enquiries with unreviewed photos; Photos to review keeps them", async () => {
  const na = await page("needs_attention");
  expect(na.total).toBe(1);
  expect(na.counts.needs_attention).toBe(1);
  expect(na.counts.photos).toBe(3);
  expect((await page("photos")).total).toBe(3);
  expect((await page("all")).total).toBe(4);
});
test("rollback restores the previous Office review count", async () => {
  await db.exec(read("0215_office_review_excludes_photos.rollback.sql"));
  expect((await page("needs_attention")).total).toBe(3);
});
