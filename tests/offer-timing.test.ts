import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { offerTiming, offersWithNoTaker, suggestAfterHours, DEFAULT_SUGGEST_AFTER_HOURS } from "../src/lib/offer-timing.core";

const sent = "2026-10-06T21:00:00.000Z"; // 8am Wed 7 Oct Melbourne (AEDT)
const at = (h: number) => new Date(Date.parse(sent) + h * 3_600_000);

describe("offer timing: 24 real hours", () => {
  test("before 24h: no suggest option", () => {
    expect(offerTiming(sent, 24, at(0)).canSuggest).toBe(false);
    expect(offerTiming(sent, 24, at(23.99)).canSuggest).toBe(false);
  });
  test("after 24h: suggest unlocked, label in Melbourne time", () => {
    const t = offerTiming(sent, 24, at(24));
    expect(t.canSuggest).toBe(true);
    expect(t.unlockLabel).toContain("8:00");
    expect(t.unlockLabel).toContain("8 Oct");
  });
  test("real hours across daylight-saving change (5 Apr 2026, clocks back)", () => {
    const s = "2026-04-04T21:00:00.000Z"; // 8am Sun 5 Apr AEDT
    const t = offerTiming(s, 24, new Date("2026-04-05T21:00:00.000Z"));
    expect(t.canSuggest).toBe(true);
    expect(t.unlockLabel).toContain("7:00"); // 24 real hours = 7am AEST next day
  });
  test("setting fallback", () => {
    expect(suggestAfterHours(null)).toBe(DEFAULT_SUGGEST_AFTER_HOURS);
    expect(suggestAfterHours(0)).toBe(24);
    expect(suggestAfterHours(36)).toBe(36);
  });
  test("office Needs me: only jobs with no taker after 24h, ready check and PIESA", () => {
    const rows = [
      { id: "1", job_id: "A", kind: "ready_check", status: "pending", offered_at: sent },
      { id: "2", job_id: "A", kind: "ready_check", status: "declined", offered_at: sent },
      { id: "3", job_id: "B", kind: "piesa", status: "pending", offered_at: sent },
      { id: "4", job_id: "C", kind: "piesa", status: "accepted", offered_at: sent },
      { id: "5", job_id: "C", kind: "piesa", status: "pending", offered_at: sent },
      { id: "6", job_id: "D", kind: "ready_check", status: "pending", offered_at: at(10).toISOString() },
    ];
    expect(offersWithNoTaker(rows, 24, at(25)).map((r) => r.job_id).sort()).toEqual(["A", "B"]);
    expect(offersWithNoTaker(rows, 24, at(20))).toEqual([]);
  });
});

describe("practice database", () => {
  test("setting column defaults to 24 and rejects 0", async () => {
    const db = new PGlite();
    await db.exec("create table public.workflow_settings (id int primary key); insert into public.workflow_settings values (1);");
    await db.exec(readFileSync("docs/pending-migrations/0135_offer_suggest_time_hours.sql", "utf8"));
    expect((await db.query<{ h: number }>("select offer_suggest_time_after_hours h from public.workflow_settings")).rows[0]!.h).toBe(24);
    await expect(db.exec("update public.workflow_settings set offer_suggest_time_after_hours = 0")).rejects.toThrow();
  });
  test("an accept closes every other offer for that job straight away", async () => {
    const db = new PGlite();
    await db.exec(`create table partner_offers (id int primary key, job_id text, kind text, status text, superseded_at timestamptz);
      insert into partner_offers values (1,'J','ready_check','pending',null),(2,'J','ready_check','pending',null),(3,'J','ready_check','declined',null),(4,'K','ready_check','pending',null);`);
    // Same statements the accept functions run (0086 accept_partner_offer, 0098 accept_ready_check_offer).
    const accept = (id: number) => db.query("with won as (update partner_offers set status='accepted' where id=$1 and status='pending' returning job_id, kind) update partner_offers p set status='withdrawn', superseded_at=now() from won where p.job_id=won.job_id and p.kind=won.kind and p.status='pending' and p.id<>$1 returning p.id", [id]);
    await accept(1);
    const late = await db.query("update partner_offers set status='accepted' where id=2 and status='pending' returning id");
    expect(late.rows.length).toBe(0);
    const rows = (await db.query<{ id: number; status: string }>("select id, status from partner_offers order by id")).rows;
    expect(rows.map((r) => r.status)).toEqual(["accepted", "withdrawn", "declined", "pending"]);
  });
});
