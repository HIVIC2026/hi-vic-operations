import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accountEnding } from "../src/lib/trade-view.core";
import { moneyWords } from "../src/lib/installer-screens.core";
const src = (p: string) => readFileSync(p, "utf8");

describe("E2 bank digits", () => {
  test("last 4 digits everywhere, never fewer", () => {
    expect(accountEnding("123 456 789")).toBe("6789");
    expect(accountEnding("12-34")).toBe("1234");
    expect(accountEnding("123")).toBeNull();
    expect(accountEnding(null)).toBeNull();
    const srv = src("src/lib/trade-view.server.ts");
    expect(srv).not.toMatch(/digits\.slice\(-3\)/);
    expect(srv.match(/accountEnding\(bank\?\.account_number\)/g)?.length).toBe(3);
  });
});

describe("E1 electrician words", () => {
  test("electricians never see install words; installer words unchanged", () => {
    const e = moneyWords("electrician");
    expect(`${e.emptyTitle} ${e.emptyBody} ${e.count(0)} ${e.count(1)} ${e.count(3)}`).not.toMatch(/install/i);
    expect(e.count(1)).toBe("1 visit");
    expect(e.count(3)).toBe("3 visits");
    expect(e.emptyTitle).toBe("No completed visits yet."); // Jo answer 1, exact
    expect(e.emptyBody).toBe("Your pay for each safety check and fixes visit shows here once the visit is done.");
    const i = moneyWords("installer");
    expect([i.emptyTitle, i.emptyBody, i.count(1), i.count(2)]).toEqual(["No completed jobs yet.", "Your pay for each install appears here once the install is done.", "1 install", "2 installs"]);
    const page = src("src/routes/_authenticated/field.money.tsx");
    expect(page).toContain("moneyWords(data.kind)");
    expect(page).not.toContain("once the install is done");
    expect(page).not.toMatch(/install\$\{t\.(this|last)Month/);
  });
});
