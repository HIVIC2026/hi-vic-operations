import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WELCOME_TAKES } from "../src/lib/trade-view.core";

// Task 11 kept the welcome page checks from installer-guide-welcome.test.ts; the guide tab itself is retired.
test("G1: welcome uses the full PIESA name", () => {
  expect(WELCOME_TAKES.electrician).toBe("Pre Insulation Electrical Safety Assessment (PIESA) jobs");
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("WELCOME_TAKES");
  expect(page).not.toContain('"PIESAs"');
  expect(page).not.toContain("/field/guide");
});
test("G3: welcome page menu follows the person — staff see only My work", () => {
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("<TradeShell installer={installer} boss={data.boss}>");
  expect(page).not.toMatch(/<TradeShell installer=\{installer\} boss>/);
  const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const fn = srv.slice(srv.indexOf("export async function tradeSetup("), srv.indexOf("export async function tradeSetupMark("));
  expect(fn).toContain("boss: c.boss");
});
