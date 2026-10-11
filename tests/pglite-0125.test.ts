import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";
test("0125 applies", async () => {
  const db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create table public.partner_workers(id uuid primary key default gen_random_uuid(), trade_role text, licence_number text);`);
  await db.exec(readFileSync(join(import.meta.dir, "..", "docs", "pending-migrations", "0125_worker_licence_piisa.sql"),"utf8"));
  await db.exec(`insert into public.partner_workers(trade_role, licence_expires_on, piisa_status) values ('electrician','2027-01-01',null),('installer',null,'not_done')`);
  await expect(db.exec(`insert into public.partner_workers(piisa_status) values ('maybe')`)).rejects.toThrow();
  const r = await db.query("select count(*)::int n from public.partner_workers");
  expect((r.rows[0] as {n:number}).n).toBe(2);
});
