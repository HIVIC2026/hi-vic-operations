// Practice database (PGlite) proof for 0224: installers read accepted installation quotes only on their own jobs.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const OWN = "10000000-0000-4000-8000-000000000001", OURS = "10000000-0000-4000-8000-000000000002";
const INST = "30000000-0000-4000-8000-000000000001", ELEC = "30000000-0000-4000-8000-000000000002", OWNER = "30000000-0000-4000-8000-000000000003";
const BASE = `
CREATE SCHEMA auth; CREATE TABLE auth.me (id uuid); INSERT INTO auth.me VALUES (NULL);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM auth.me LIMIT 1 $$;
CREATE TYPE quote_kind AS ENUM ('installation','rectification');
CREATE TYPE quote_status AS ENUM ('draft','issued','accepted','declined','superseded','expired');
CREATE TABLE public.jobs (id uuid primary key, channel text, owner_user uuid);
CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, role text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_job_owner(_job uuid, _user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.jobs WHERE id = _job AND owner_user = _user) $$;
CREATE FUNCTION public.owner_quote_released(_s quote_status, _r text, _sent timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _sent IS NOT NULL $$;
CREATE FUNCTION public.job_assignment_role(_job uuid, _user uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM public.job_assignments WHERE job_id = _job AND user_id = _user LIMIT 1 $$;
INSERT INTO public.jobs VALUES ('${OWN}','installer_sourced','${OWNER}'),('${OURS}','hivic_sourced','${OWNER}');
INSERT INTO public.job_assignments VALUES ('${OWN}','${INST}','installer'),('${OURS}','${INST}','installer'),('${OURS}','${ELEC}','electrician');`;

let db: PGlite;
const as = (u: string) => db.exec(`UPDATE auth.me SET id = '${u}'`);
const sees = async (job: string, kind = "installation", status = "accepted", sent = "now()") =>
  (await db.query<{ v: boolean }>(`SELECT public.quote_visible_to_current_user('${job}','${kind}','${status}',NULL,${sent}) AS v`)).rows[0]!.v;

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(read("0224_installer_quote_visibility.rollback.sql")); });

describe("0224 installer quote visibility (practice database)", () => {
  test("before: the installer can read our-lead accepted quotes (the gap)", async () => {
    await as(INST);
    expect(await sees(OURS)).toBe(true);
  });
  test("after: own jobs still visible, our leads hidden; drafts never", async () => {
    await db.exec(read("0224_installer_quote_visibility.sql"));
    await as(INST);
    expect(await sees(OWN)).toBe(true);
    expect(await sees(OURS)).toBe(false);
    expect(await sees(OWN, "installation", "draft")).toBe(false);
  });
  test("owner and electrician access unchanged; running twice is safe", async () => {
    await db.exec(read("0224_installer_quote_visibility.sql")); await db.exec(read("0224_installer_quote_visibility.sql"));
    await as(OWNER);
    expect(await sees(OURS, "installation", "issued")).toBe(true);
    expect(await sees(OURS, "installation", "issued", "NULL")).toBe(false);
    await as(ELEC);
    expect(await sees(OURS, "rectification", "issued")).toBe(true);
  });
  test("rollback restores the old behaviour", async () => {
    await db.exec(read("0224_installer_quote_visibility.sql")); await db.exec(read("0224_installer_quote_visibility.rollback.sql"));
    await as(INST);
    expect(await sees(OURS)).toBe(true);
  });
});
