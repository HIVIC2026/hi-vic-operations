// Practice-database (PGlite) check for 0222: re-run safe, preliminary link purpose allowed, Office one
// pile includes manual portal-source enquiries, rollback refuses while a preliminary link exists and
// restores the base44-only scope. Synthetic rows only — no real records, nothing applied to production.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
// Pre-0222 state: the two-value purpose check.
await db.exec(`CREATE TABLE public.customer_estimate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  purpose text NOT NULL,
  token text,
  status text DEFAULT 'active',
  expires_at timestamptz,
  CONSTRAINT customer_estimate_links_purpose_check CHECK (purpose IN ('step3_estimate', 'ready_check_times'))
);`);
// Stub of the office_enquiry_index view with every column office_enquiry_page reads.
await db.exec(`CREATE TABLE public.office_enquiry_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  channel text NOT NULL,
  office_bucket text NOT NULL,
  media_to_review boolean DEFAULT false,
  spot_offered boolean DEFAULT false,
  enquiry_status text,
  spot_saved boolean DEFAULT false,
  removed boolean DEFAULT false,
  deleted_at timestamptz,
  owner_progressed boolean DEFAULT false,
  needs_first_response boolean DEFAULT false,
  owner_name text, owner_email text, owner_phone text,
  property_address text, job_number text, external_enquiry_id text,
  contact_rank int DEFAULT 1,
  response_state text DEFAULT 'none',
  latest_attempt_status text,
  created_at timestamptz DEFAULT now()
);`);

await db.exec(read("0222_email_preliminary_save_spot.sql"));
await db.exec(read("0222_email_preliminary_save_spot.sql")); // re-run safe

// 1) Purpose check: preliminary_save_spot allowed, junk still rejected.
await db.query(`INSERT INTO customer_estimate_links (purpose, token) VALUES ('preliminary_save_spot', 'tok1')`);
let junkRejected = false;
try { await db.query(`INSERT INTO customer_estimate_links (purpose, token) VALUES ('junk', 'tok2')`); } catch { junkRejected = true; }
if (!junkRejected) throw new Error("junk link purpose accepted after 0222");

// 2) One pile: a manual portal enquiry and a base44 enquiry both appear in the office page.
await db.query(`INSERT INTO office_enquiry_index (source, channel, office_bucket, enquiry_status, owner_name, created_at)
  VALUES ('base44','hivic_sourced','enquiry','new',  'Base44 Owner', now() - interval '1 hour'),
         ('portal','hivic_sourced','enquiry','new',  'Manual Owner', now())`);
const page = await db.query<{ result: { ids: string[]; counts: { all: number } } }>(`SELECT office_enquiry_page('all','',1) AS result`);
const ids = page.rows[0]!.result.ids;
const names = await db.query<{ id: string; owner_name: string }>(`SELECT id, owner_name FROM office_enquiry_index WHERE id = ANY($1::uuid[])`, [ids]);
const found = names.rows.map(r => r.owner_name).sort();
if (found.join("|") !== "Base44 Owner|Manual Owner") throw new Error(`office one pile wrong: ${found.join("|")}`);
if (page.rows[0]!.result.counts.all !== 2) throw new Error("office all count wrong");

// 3) Rollback refuses while a preliminary link exists.
let refused = false;
try { await db.exec(read("0222_email_preliminary_save_spot.rollback.sql")); } catch { refused = true; }
if (!refused) throw new Error("rollback ran with a live preliminary link");

// 4) After revoking the link, rollback restores base44-only scope and the two-value purpose check.
await db.exec(`DELETE FROM customer_estimate_links WHERE purpose = 'preliminary_save_spot'`);
await db.exec(read("0222_email_preliminary_save_spot.rollback.sql"));
const after = await db.query<{ result: { ids: string[] } }>(`SELECT office_enquiry_page('all','',1) AS result`);
const afterNames = await db.query<{ owner_name: string }>(`SELECT owner_name FROM office_enquiry_index WHERE id = ANY($1::uuid[])`, [after.rows[0]!.result.ids]);
if (afterNames.rows.map(r => r.owner_name).join("|") !== "Base44 Owner") throw new Error("rollback did not restore base44-only scope");
let purposeRejected = false;
try { await db.query(`INSERT INTO customer_estimate_links (purpose, token) VALUES ('preliminary_save_spot', 'tok3')`); } catch { purposeRejected = true; }
if (!purposeRejected) throw new Error("purpose still allowed after rollback");

console.log("PASS: 0222 preliminary save spot — re-run safe, purpose allowed, office one pile includes portal, rollback guarded and clean (practice database)");
