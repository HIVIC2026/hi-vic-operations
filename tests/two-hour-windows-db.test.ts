// Practice database (PGlite) for 0117: new Ready Check windows must be 2 hours; old half-day rows are kept.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { windowBounds } from "../src/lib/piesa-windows.core";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
test("0117 two-hour windows: apply, enforce, keep history, undo", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.ready_check_windows (id serial primary key, job_id uuid, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL);
    INSERT INTO ready_check_windows (starts_at, ends_at) VALUES ('2026-10-06T21:00Z','2026-10-07T01:00Z');`);
  await db.exec(read("0117_two_hour_windows.sql"));
  await db.exec(read("0117_two_hour_windows.sql")); // re-runnable
  const w = windowBounds("2026-10-07", "10-12");
  await db.query(`INSERT INTO ready_check_windows (starts_at, ends_at) VALUES ($1,$2)`, [w.starts_at, w.ends_at]);
  await expect(db.exec(`INSERT INTO ready_check_windows (starts_at, ends_at) VALUES ('2026-10-06T21:00Z','2026-10-07T01:00Z')`)).rejects.toThrow(/two_hours/);
  expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM ready_check_windows")).rows[0]!.n).toBe(2);
  await db.exec(read("0117_two_hour_windows.rollback.sql"));
  await db.exec(`INSERT INTO ready_check_windows (starts_at, ends_at) VALUES ('2026-10-06T21:00Z','2026-10-07T01:00Z')`);
});
