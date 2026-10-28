import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accountEnding } from "../src/lib/trade-view.core";
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
