import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearTradeCache, forgetRefusedCopy, readLastCopy, readTradeCache, writeLastCopy, writeTradeCache } from "../src/lib/trade-cache";
import { OWNER_ONLY_REFUSALS } from "../src/lib/owner-only.core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

class FakeStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const g = globalThis as unknown as { localStorage?: unknown };
let orig: unknown;
const realNow = Date.now;
const setNow = (t: number) => { Date.now = () => t; };
beforeEach(() => { Date.now = realNow; resetTradeCacheSignOut(); orig = g.localStorage; g.localStorage = new FakeStorage(); });
afterEach(() => { Date.now = realNow; g.localStorage = orig; });

describe("trade cache", () => {
  test("write then read returns the data for the same user", () => {
    writeTradeCache("u1", "home", { a: 1 });
    const r = readTradeCache<{ a: number }>("u1", "home");
    expect(r?.data).toEqual({ a: 1 });
    expect(typeof r?.at).toBe("number");
  });
  test("another user gets nothing", () => {
    writeTradeCache("u1", "home", { a: 1 });
    expect(readTradeCache("u2", "home")).toBeNull();
  });
  test("clear removes every hiv-trade key and no others", () => {
    writeTradeCache("u1", "home", 1);
    writeTradeCache("u2", "business", 2);
    (g.localStorage as FakeStorage).setItem("other", "keep");
    clearTradeCache();
    const s = g.localStorage as FakeStorage;
    expect([...s.m.keys()]).toEqual(["other"]);
  });
  test("an entry older than 24 hours is ignored", () => {
    const s = g.localStorage as FakeStorage;
    s.setItem("hiv-trade:v1:u1:home", JSON.stringify({ at: Date.now() - 24 * 3600_000 - 1000, data: 1 }));
    expect(readTradeCache("u1", "home")).toBeNull();
    s.setItem("hiv-trade:v1:u1:fresh", JSON.stringify({ at: Date.now() - 3600_000, data: 2 }));
    expect(readTradeCache("u1", "fresh")?.data).toBe(2);
  });
  test("garbage in storage reads as no cache", () => {
    (g.localStorage as FakeStorage).setItem("hiv-trade:v1:u1:home", "{not json");
    expect(readTradeCache("u1", "home")).toBeNull();
  });
  test("a throwing storage never throws", () => {
    const boom = () => { throw new Error("denied"); };
    g.localStorage = { get length() { return boom(); }, key: boom, getItem: boom, setItem: boom, removeItem: boom };
    expect(readTradeCache("u1", "home")).toBeNull();
    expect(() => writeTradeCache("u1", "home", 1)).not.toThrow();
    expect(() => clearTradeCache()).not.toThrow();
  });
  test("no storage at all is no cache", () => {
    g.localStorage = undefined;
    expect(readTradeCache("u1", "home")).toBeNull();
    expect(() => writeTradeCache("u1", "home", 1)).not.toThrow();
    expect(() => clearTradeCache()).not.toThrow();
  });
});

describe("trade cache keys per job", () => {
  test("two jobs for one user do not mix, and a null/absent entry reads as none", () => {
    writeTradeCache("u1", "job-bundle:a", { overview: 1 });
    writeTradeCache("u1", "job-bundle:b", { overview: 2 });
    expect(readTradeCache<{ overview: number }>("u1", "job-bundle:a")?.data.overview).toBe(1);
    expect(readTradeCache<{ overview: number }>("u1", "job-bundle:b")?.data.overview).toBe(2);
    expect(readTradeCache("u1", "job-bundle:c")).toBeNull();
  });
});

import { evictPlan } from "../src/lib/trade-job-bundle.core";
import { resetTradeCacheSignOut } from "../src/lib/trade-cache";

describe("evictPlan", () => {
  const seeded = ["overview", "role", "page"] as const;
  test("a refused or failed fresh bundle drops the cached copy and every seeded section", () => {
    expect(evictPlan(seeded, { overview: { error: "no" } })).toEqual({ dropCache: true, sections: ["overview", "role", "page"] });
    expect(evictPlan(seeded, null)).toEqual({ dropCache: true, sections: ["overview", "role", "page"] });
  });
  test("a usable bundle drops only seeded sections it did not answer", () => {
    expect(evictPlan(seeded, { overview: { id: 1 }, role: "installer", page: { error: "x" } })).toEqual({ dropCache: false, sections: ["page"] });
    expect(evictPlan(seeded, { overview: { id: 1 }, role: "installer", page: {} })).toEqual({ dropCache: false, sections: [] });
    expect(evictPlan(seeded, { overview: { id: 1 } })).toEqual({ dropCache: false, sections: ["role", "page"] });
  });
});

describe("sign-out race", () => {
  test("after clearTradeCache a late write is ignored", () => {
    writeTradeCache("u1", "home", 1);
    clearTradeCache();
    writeTradeCache("u1", "home", 2);
    expect(readTradeCache("u1", "home")).toBeNull();
    resetTradeCacheSignOut();
    writeTradeCache("u1", "home", 3);
    expect(readTradeCache("u1", "home")?.data).toBe(3);
  });
});

// Plan Task 3 / review focus 1: a copy is only ever written for the signed-in user who received the data, so staff never
// hold a money copy. The one way a stale owner-only copy could show is a person who WAS the business owner and no
// longer is: the server now refuses, and the refusal must take the kept copy with it so the next visit shows nothing.
describe("owner-only screens: a refusal drops the kept copy", () => {
  test("the owner-only refusals drop the copy; any other failure keeps it (offline use)", () => {
    for (const text of OWNER_ONLY_REFUSALS) {
      writeTradeCache("u1", "money", { rows: [1] });
      forgetRefusedCopy("u1", "money", new Error(text));
      expect(readTradeCache("u1", "money")).toBeNull();
    }
    writeTradeCache("u1", "money", { rows: [1] });
    forgetRefusedCopy("u1", "money", new Error("Failed to fetch"));
    forgetRefusedCopy("u1", "money", "not an error");
    forgetRefusedCopy("u1", "money", null);
    expect(readTradeCache("u1", "money")?.data).toEqual({ rows: [1] });
    expect(() => forgetRefusedCopy("", "money", new Error(OWNER_ONLY_REFUSALS[0]!))).not.toThrow();
  });
  test("the refusal texts are the ones the server throws (bossOrThrow, tradeMoney), from one import-free module", () => {
    const server = readFileSync(join(import.meta.dir, "..", "src", "lib", "trade-view.server.ts"), "utf8");
    expect(server).toMatch(/from\s+["']\.\/owner-only\.core["']/);
    for (const text of OWNER_ONLY_REFUSALS) expect(server).not.toContain(`"${text}"`);
    expect(OWNER_ONLY_REFUSALS).toEqual(["Only the business owner can see this.", "Money is only shown to the business owner."]);
    expect(readFileSync(join(import.meta.dir, "..", "src", "lib", "owner-only.core.ts"), "utf8")).not.toMatch(/(?:^|\n)\s*(?:import|export)\s[^;]*\sfrom\s/);
  });
  test("the owner-only screens forget a refused copy in their fetch", () => {
    for (const f of ["src/routes/_authenticated/field.money.tsx", "src/routes/_authenticated/field.money_.$jobId.tsx", "src/components/trade/business-pages.tsx"]) {
      const code = readFileSync(join(import.meta.dir, "..", f), "utf8");
      expect(code).toContain("forgetRefusedCopy(uid,");
    }
  });
});

describe("job-page copies are capped", () => {
  const s = () => g.localStorage as FakeStorage;
  test("the 16th office job copy evicts the oldest", () => {
    const t0 = Date.now();
    for (let i = 1; i <= 16; i++) { setNow(t0 + i * 1000); writeLastCopy("u1", `office-job:j${i}`, { i }); }
    setNow(t0 + 20_000);
    expect(readLastCopy("u1", "office-job:j1")).toBeNull();
    expect(readLastCopy("u1", "office-job:j2")?.data).toEqual({ i: 2 });
    expect(readLastCopy("u1", "office-job:j16")?.data).toEqual({ i: 16 });
    expect([...s().m.keys()].filter((k) => k.includes("office-job:")).length).toBe(15);
  });
  test("the 16th installer job copy evicts the oldest, and lists are untouched", () => {
    const t0 = Date.now();
    writeLastCopy("u1", "jobs:active", 1);
    for (let i = 1; i <= 16; i++) { setNow(t0 + i * 1000); writeTradeCache("u1", `job-bundle:j${i}`, { i }); }
    setNow(t0 + 20_000);
    expect(readTradeCache("u1", "job-bundle:j1")).toBeNull();
    expect(readTradeCache("u1", "job-bundle:j2")).not.toBeNull();
    expect(readLastCopy("u1", "jobs:active")).not.toBeNull();
  });
  test("another user's copies do not count toward the limit", () => {
    const t0 = Date.now();
    for (let i = 1; i <= 15; i++) { setNow(t0 + i * 1000); writeLastCopy("u2", `office-job:j${i}`, i); }
    setNow(t0 + 20_000);
    writeLastCopy("u1", "office-job:a", 1);
    expect(readLastCopy("u2", "office-job:j1")).not.toBeNull();
  });
  test("an expired copy is removed when read", () => {
    s().setItem("hiv-last:v1:u1:office-job:old", JSON.stringify({ at: Date.now() - 24 * 3600_000 - 1000, data: 1 }));
    expect(readLastCopy("u1", "office-job:old")).toBeNull();
    expect(s().getItem("hiv-last:v1:u1:office-job:old")).toBeNull();
  });
  test("sign-out clears every job copy and a different user sees none", () => {
    writeLastCopy("u1", "office-job:a", 1);
    writeTradeCache("u1", "job-bundle:a", 1);
    expect(readLastCopy("u2", "office-job:a")).toBeNull();
    expect(readTradeCache("u2", "job-bundle:a")).toBeNull();
    clearTradeCache();
    expect([...s().m.keys()]).toEqual([]);
  });
});
