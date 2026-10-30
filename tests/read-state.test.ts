import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COULDNT_LOAD, pileCount, switchLabel, tileText } from "../src/lib/read-state.core";

test("tiles: failed read says Couldn't load, loading says …, data shows the value (zero stays zero)", () => {
  expect(tileText({ hasData: false, failed: true }, () => "$0")).toBe(COULDNT_LOAD);
  expect(tileText({ hasData: false, failed: false }, () => "$0")).toBe("…");
  expect(tileText({ hasData: true, failed: false }, () => "$0")).toBe("$0");
});
test("piles: failed is not a number and not …", () => {
  expect(pileCount({ count: undefined, failed: true })).toBe("couldn't load");
  expect(pileCount({ count: undefined, failed: false })).toBe("…");
  expect(pileCount({ count: 0, failed: false })).toBe("0");
});
test("switch with unreadable state is not Off", () => {
  expect(switchLabel(null)).toBe("Couldn't read");
  expect(switchLabel(false)).toBe("Off");
  expect(switchLabel(true)).toBe("On");
});
const src = (p: string) => readFileSync(p, "utf8");
test("screens use the honest states", () => {
  const money = src("src/routes/_authenticated/admin.money.tsx");
  expect(money).not.toContain(": \"…\"}");
  expect(money).toContain("tileText(");
  const jobs = src("src/components/portal/JobsScreen.tsx");
  expect(jobs).not.toContain('picks.isError ? "?"');
  expect(jobs).toMatch(/Closed jobs[\s\S]{0,200}retry|what="Closed jobs"/);
  const settings = src("src/routes/_authenticated/admin.settings.tsx");
  expect(settings).not.toContain("<Pill>Unknown</Pill>");
  expect(settings).toContain("Couldn't read");
  const comms = src("src/lib/office-comms.server.ts");
  expect(comms).toMatch(/Could not read jobs/);
});
