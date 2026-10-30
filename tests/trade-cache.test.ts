import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearTradeCache, readTradeCache, writeTradeCache } from "../src/lib/trade-cache.client";

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
beforeEach(() => { resetTradeCacheSignOut(); orig = g.localStorage; g.localStorage = new FakeStorage(); });
afterEach(() => { g.localStorage = orig; });

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
import { resetTradeCacheSignOut } from "../src/lib/trade-cache.client";

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
