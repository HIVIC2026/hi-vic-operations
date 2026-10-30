import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GUIDE_STEPS, WELCOME_TAKES } from "../src/lib/trade-view.core";

const all = GUIDE_STEPS.map((s) => s.body).join(" ");
test("G1: guide and welcome use the full PIESA name", () => {
  expect(all).toContain("Pre Insulation Electrical Safety Assessment (PIESA)");
  // The full name comes first; "PIESA" alone only after it (Jo 29 Oct, Install days body).
  const full = "Pre Insulation Electrical Safety Assessment (";
  expect(all.indexOf("PIESA")).toBe(all.indexOf(`${full}PIESA)`) + full.length);
  expect(GUIDE_STEPS[3]).toEqual({ title: "Install days", body: "Once the PIESA is cleared, offer the owner 3 days with arrival times. Install within 30 days of the PIESA, or a new one is needed." });
  expect(GUIDE_STEPS.map((s) => s.body).join(" ")).not.toMatch(/electrical safety check|safety check is cleared/i);
  expect(WELCOME_TAKES.electrician).toBe("Pre Insulation Electrical Safety Assessment (PIESA) jobs");
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("WELCOME_TAKES");
  expect(page).not.toContain('"PIESAs"');
});
test("G2: SWMS, PIISA, VEEC and Part B explained the first time they appear", () => {
  for (const [term, plain] of [["SWMS", "Safe Work Method Statement"], ["PIISA", "Pre-installation installer safety assessment"], ["VEEC", "the rebate form"], ["Part B", "your declaration"]] as const) {
    const at = all.indexOf(term);
    expect(at).toBeGreaterThan(-1);
    expect(all.slice(at, at + 140)).toContain(plain);
  }
});
test("guide still has the same five steps", () => {
  expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "PIESA", "Install days", "Install day"]);
});

test("G3: welcome page menu follows the person — staff see only My work", () => {
  const page = readFileSync("src/routes/_authenticated/field.welcome.tsx", "utf8");
  expect(page).toContain("<TradeShell installer={installer} boss={data.boss}>");
  expect(page).not.toMatch(/<TradeShell installer=\{installer\} boss>/);
  const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
  const fn = srv.slice(srv.indexOf("export async function tradeSetup("), srv.indexOf("export async function tradeSetupMark("));
  expect(fn).toContain("boss: c.boss");
});
