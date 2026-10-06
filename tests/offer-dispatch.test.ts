import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { chooseWarnings, distanceKm, needsChooseTrades, newRecipients, officePicks } from "../src/lib/offer-dispatch.core";

describe("how job offers go out", () => {
  test("office picks is the default and fails closed", () => {
    expect(officePicks("office_picks", null)).toBe(true);
    expect(officePicks(null, null)).toBe(true);
    expect(officePicks("weird", null)).toBe(true);
    expect(officePicks("automatic", null)).toBe(false);
    expect(officePicks("automatic", "office_picks")).toBe(true);
  });
  test("Needs me 'Choose trades' only when nothing is out yet", () => {
    expect(needsChooseTrades({ officePicks: true, readyForOffer: true, hasTrade: false, offersThisRound: 0 })).toBe(true);
    expect(needsChooseTrades({ officePicks: true, readyForOffer: true, hasTrade: false, offersThisRound: 2 })).toBe(false);
    expect(needsChooseTrades({ officePicks: false, readyForOffer: true, hasTrade: false, offersThisRound: 0 })).toBe(false);
  });
  test("only ticked trades, never twice; already-offered keep theirs", () => {
    expect(newRecipients(["a", "b", "b", "c"], new Set(["a"]))).toEqual(["b", "c"]);
  });
  test("warnings", () => {
    const w = chooseWarnings({ today: "2026-10-07", insuranceExpiresOn: ["2026-10-20"], certExpiresOn: ["2027-06-01"], rate: 349, ownerPrice: 349 });
    expect(w).toEqual(["Insurance expires 2026-10-20", "Rate is at or above the owner price"]);
    expect(chooseWarnings({ today: "2026-10-07", insuranceExpiresOn: [], certExpiresOn: ["2026-10-01"], rate: null, ownerPrice: 349 })).toEqual(["Licence/cert expired 2026-10-01", "No agreed rate for this job"]);
    expect(chooseWarnings({ today: "2026-10-07", insuranceExpiresOn: ["2027-01-01"], certExpiresOn: [], rate: 200, ownerPrice: 349 })).toEqual([]);
  });
  test("distance", () => {
    expect(distanceKm({ lat: -37.81, lng: 144.96 }, { lat: -37.70, lng: 144.70 })).toBe(26);
    expect(distanceKm({ lat: null, lng: null }, { lat: -37.7, lng: 144.7 })).toBeNull();
  });
  test("practice database: defaults and checks", async () => {
    const db = new PGlite();
    await db.exec("create table public.workflow_settings (id int primary key); insert into public.workflow_settings values (1); create table public.jobs (id int primary key); insert into public.jobs values (1);");
    await db.exec(readFileSync("docs/pending-migrations/0136_offer_dispatch_mode.sql", "utf8"));
    expect((await db.query<{ m: string }>("select offer_dispatch_mode m from public.workflow_settings")).rows[0]!.m).toBe("office_picks");
    await expect(db.exec("update public.workflow_settings set offer_dispatch_mode='all'")).rejects.toThrow();
    await db.exec("update public.jobs set offer_dispatch_override='office_picks'");
    await expect(db.exec("update public.jobs set offer_dispatch_override='automatic'")).rejects.toThrow();
  });
});
