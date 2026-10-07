import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

describe("0138 partner change requests (practice database)", () => {
  test("table, checks and re-run safety", async () => {
    const db = new PGlite();
    await db.exec(`
      create role authenticated; create role service_role;
      create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table public.businesses (id uuid primary key);
      create function public.is_admin(u uuid) returns boolean language sql as $$ select false $$;
      insert into public.businesses values ('00000000-0000-0000-0000-000000000001');`);
    const sql = readFileSync("docs/pending-migrations/0138_partner_change_requests.sql", "utf8");
    await db.exec(sql);
    await db.exec(sql);
    await db.exec("insert into public.partner_change_requests (business_id, kind, message, requested_by) values ('00000000-0000-0000-0000-000000000001','rates','R5 to $27 please', gen_random_uuid())");
    expect((await db.query<{ s: string }>("select status s from public.partner_change_requests")).rows[0]!.s).toBe("open");
    await expect(db.exec("insert into public.partner_change_requests (business_id, kind, message, requested_by) values ('00000000-0000-0000-0000-000000000001','prices','hi', gen_random_uuid())")).rejects.toThrow();
    await expect(db.exec("insert into public.partner_change_requests (business_id, kind, message, requested_by) values ('00000000-0000-0000-0000-000000000001','rates','  ', gen_random_uuid())")).rejects.toThrow();
  });
});
