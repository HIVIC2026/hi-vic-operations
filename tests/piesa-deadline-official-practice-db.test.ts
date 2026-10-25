// Decision 316 (Jo 25 Oct 2026): the 30-day window runs from the official PIESA, never the fixes date.
// docs/pending-migrations/piesa-deadline-from-official-piesa.sql proven on a practice Postgres (PGlite), never live.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync("docs/pending-migrations/piesa-deadline-from-official-piesa.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/piesa-deadline-from-official-piesa.rollback.sql", "utf8");
const db = new PGlite();
await db.exec(`
  create type job_stage as enum ('installation_scheduling','complete','cancelled');
  create table jobs(id text primary key, stage job_stage not null default 'installation_scheduling', installation_completed_at timestamptz);
  create table workflow_settings(id int primary key, piesa_install_window_days int not null default 30, urgency_red_days int not null default 7, urgency_amber_days int not null default 14);
  insert into workflow_settings(id) values (1);
  create table piesa_records(id serial primary key, job_id text, kind text, outcome text, completed_date date, is_current boolean, created_at timestamptz);
  insert into jobs(id) values ('fixes'), ('plain'), ('redo'), ('none');
  insert into piesa_records(job_id, kind, outcome, completed_date, is_current, created_at) values
    ('fixes','initial','fail','2026-10-01',false,'2026-10-01T01:00Z'),
    ('fixes','post_rectification','pass','2026-10-12',true,'2026-10-12T01:00Z'),
    ('plain','initial','pass','2026-10-03',true,'2026-10-03T01:00Z'),
    ('redo','initial','pass','2026-08-01',false,'2026-08-01T01:00Z'),
    ('redo','reassessment','pass','2026-10-05',true,'2026-10-05T01:00Z');
`);
await db.exec(ROLLBACK); // the view as it is live today
const rows = async () => Object.fromEntries((await db.query<{ job_id: string; piesa_date: string | null; piesa_outcome: string | null; install_deadline: string | null }>(
  "select job_id, piesa_date::text, piesa_outcome, install_deadline::text from job_piesa_deadlines order by job_id")).rows.map((r) => [r.job_id, r]));

describe("job_piesa_deadlines on PGlite", () => {
  test("before: a fixes job's deadline runs from the fixes date (the bug)", async () => {
    expect((await rows())["fixes"]).toMatchObject({ piesa_date: "2026-10-12", install_deadline: "2026-11-11" });
  });
  test("after: deadline runs from the official PIESA; outcome from the current record; idempotent", async () => {
    await db.exec(MIGRATION); await db.exec(MIGRATION);
    const r = await rows();
    expect(r["fixes"]).toMatchObject({ piesa_date: "2026-10-01", piesa_outcome: "pass", install_deadline: "2026-10-31" });
    expect(r["plain"]).toMatchObject({ piesa_date: "2026-10-03", install_deadline: "2026-11-02" });
    expect(r["redo"]).toMatchObject({ piesa_date: "2026-10-05", install_deadline: "2026-11-04" }); // a reassessment is a new official PIESA
    expect(r["none"]).toMatchObject({ piesa_date: null, install_deadline: null });
  });
  test("rollback restores the old view", async () => {
    await db.exec(ROLLBACK);
    expect((await rows())["fixes"]).toMatchObject({ install_deadline: "2026-11-11" });
  });
});
