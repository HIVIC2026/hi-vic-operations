import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NO_LOGIN_NEEDED, noLoginFor, seesMoney, seesPrices, tradeRoleOf } from "../src/lib/trade-access-role.core";
import { memberRoleFor, tradeAccessBlocker } from "../src/lib/trade-access.core";

const src = (p: string) => readFileSync(p, "utf8");
const worker = { email: "a@b.com", approval_status: "approved", removed_at: null, trade_role: "installer", certification_status: "verified" };

describe("trade roles", () => {
  test("who is boss, office or nobody", () => {
    expect(tradeRoleOf({ memberRole: "business_admin", workerTradeRole: null })).toBe("boss");
    expect(tradeRoleOf({ memberRole: "office", workerTradeRole: "office" })).toBe("office");
    expect(tradeRoleOf({ memberRole: "member", workerTradeRole: "installer" })).toBe("none");
    expect(tradeRoleOf({ memberRole: "member", workerTradeRole: "electrician" })).toBe("none");
    expect(tradeRoleOf({ memberRole: null, workerTradeRole: null })).toBe("none");
  });
  test("prices and Money", () => {
    expect(seesPrices("boss")).toBe(true);
    expect(seesPrices("office")).toBe(true);
    expect(seesPrices("none")).toBe(false);
    expect(seesMoney("office", false)).toBe(false);
    expect(seesMoney("office", true)).toBe(true);
    expect(seesMoney("boss", false)).toBe(true);
    expect(seesMoney("none", true)).toBe(false);
  });
  test("sign-in rules", () => {
    expect(memberRoleFor("mia@x.com", "boss@x.com", "office")).toBe("office");
    expect(memberRoleFor("boss@x.com", "boss@x.com", "office")).toBe("business_admin");
    expect(memberRoleFor("mia@x.com", "boss@x.com")).toBe("member");
    expect(tradeAccessBlocker({ ...worker }, true)).toBe(NO_LOGIN_NEEDED);
    expect(tradeAccessBlocker({ ...worker, trade_role: "electrician", certification_status: null }, true)).toBe(NO_LOGIN_NEEDED);
    expect(tradeAccessBlocker({ ...worker, profile_id: null }, true)).toBe(NO_LOGIN_NEEDED);
    // existing logins stay recoverable
    expect(tradeAccessBlocker({ ...worker, profile_id: "p1" }, true)).toBeNull();
    expect(tradeAccessBlocker({ ...worker, trade_role: "electrician", profile_id: "p2" }, true)).toBeNull();
    expect(tradeAccessBlocker({ ...worker, trade_role: "office", certification_status: null }, true)).toBeNull();
    expect(tradeAccessBlocker({ ...worker, trade_role: "office", email: null }, true)).toBe("This person needs a valid email.");
  });
});

describe("Money is guarded by the Money rule, not the boss rule", () => {
  const s = src("src/lib/trade-view.server.ts");
  const body = (name: string) => s.slice(s.indexOf(`export async function ${name}(`), s.indexOf("\nexport ", s.indexOf(`export async function ${name}(`) + 10));
  test.each(["tradeMoney", "tradeMoneyJob", "tradeMoneyExtras"])("%s calls moneyOrThrow", (n) => {
    expect(body(n)).toContain("moneyOrThrow(");
    expect(body(n)).not.toContain("bossOrThrow(");
  });
  test("pricesOrThrow exists for Part 10 and the context carries role, prices and money", () => {
    expect(s).toContain("export async function pricesOrThrow(");
    expect(s).toMatch(/role,\s*prices:[^\n]*money:/);
  });
  test("the Money screen's error state links back to My work", () => {
    expect(src("src/routes/_authenticated/field.money.tsx")).toMatch(/if \(error\)[^\n]*<Link to="\/field"/);
  });
  test("field.tsx shows the no-login page for role none", () => {
    expect(src("src/routes/_authenticated/field.tsx")).toContain("components/trade/FieldLayout");
    const f = src("src/components/trade/FieldLayout.tsx");
    expect(f).toContain("NO_LOGIN_NEEDED");
    expect(f).toContain("TradePublicShell");
  });
  test("the no-login page shows only with no active membership at all (a legacy 'member' keeps the normal layout)", () => {
    const f = src("src/components/trade/FieldLayout.tsx");
    expect(f).toContain("noLogin");
    expect(f).not.toContain('role !== "none"');
    expect(noLoginFor([])).toBe(true);
    expect(noLoginFor([{ member_role: "member" }])).toBe(false);
    expect(noLoginFor([{ member_role: "office" }])).toBe(false);
    expect(noLoginFor([{ member_role: "business_admin" }])).toBe(false);
  });
});
