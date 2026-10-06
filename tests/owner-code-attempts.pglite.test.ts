import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Practice database proof of the compare-and-swap used by verifyOwnerCode (same SQL PostgREST sends).
describe("8. owner code attempts are atomic", () => {
  test("20 parallel guesses use at most 5 tries", async () => {
    const db = new PGlite();
    await db.exec(`create table owner_link_codes (id int primary key, attempts int not null default 0, verified_at timestamptz, expires_at timestamptz not null);
      insert into owner_link_codes values (1, 0, null, now() + interval '10 minutes');`);
    let ok = 0;
    for (let round = 0; round < 20; round++) {
      // Every guess first reads the count, then tries to swap it — all 4 in a batch see the same value.
      const read = (await db.query<{ attempts: number }>("select attempts from owner_link_codes where id=1")).rows[0]!.attempts;
      const results = await Promise.all([0, 1, 2, 3].map(() => db.query("update owner_link_codes set attempts = $1 where id=1 and attempts = $2 and attempts < 5 and verified_at is null and expires_at > now() returning id", [read + 1, read])));
      ok += results.filter((r) => r.rows.length).length;
    }
    expect(ok).toBe(5);
    expect((await db.query<{ attempts: number }>("select attempts from owner_link_codes")).rows[0]!.attempts).toBe(5);
  });
});
