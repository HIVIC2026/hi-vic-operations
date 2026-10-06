import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const SQL = readFileSync(new URL("../docs/pending-migrations/0133_owner_autolink_verified.sql", import.meta.url), "utf8");
test("account is linked to an owner only after that owner verified their email via their code link", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE profiles(id uuid primary key, full_name text, email text);
CREATE TABLE user_roles(user_id uuid, role text, unique(user_id, role));
CREATE TABLE owners(id uuid primary key, email text, user_id uuid);
CREATE TABLE jobs(id uuid primary key, owner_id uuid);
CREATE TABLE owner_link_codes(id uuid primary key default gen_random_uuid(), job_id uuid, channel text, verified_at timestamptz);
CREATE TABLE users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
INSERT INTO owners VALUES ('00000000-0000-4000-8000-000000000001','a@x.test',null),('00000000-0000-4000-8000-000000000002','b@x.test',null);
INSERT INTO jobs VALUES ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-000000000002');
INSERT INTO owner_link_codes(job_id, channel, verified_at) VALUES ('00000000-0000-4000-8000-0000000000a1','email',now()),('00000000-0000-4000-8000-0000000000a2','sms',now());`);
  await db.exec(SQL.replace(/public\./g, ""));
  await db.exec(`CREATE TRIGGER t AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
INSERT INTO users(id,email) VALUES ('00000000-0000-4000-8000-0000000000f1','A@x.test'),('00000000-0000-4000-8000-0000000000f2','b@x.test');`);
  const o = (await db.query<{ email: string; user_id: string | null }>("select email, user_id from owners order by email")).rows;
  expect(o[0]!.user_id).toBe("00000000-0000-4000-8000-0000000000f1");
  expect(o[1]!.user_id).toBeNull(); // only SMS-verified: email not proven -> no takeover
  expect((await db.query("select * from user_roles where role='admin'")).rows.length).toBe(0);
});
