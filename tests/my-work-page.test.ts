import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8");
const server = readFileSync("src/lib/trade-view.server.ts", "utf8");

describe("My work page (installer)", () => {
  test("tabs, search and greeting use the approved words", () => {
    for (const w of ["Your turn ·", "All jobs ·", "Search name, address or HV number", "myWork.greeting.title", "myWork.greeting.sub"]) expect(page).toContain(w);
  });
  test("overdue cards get a red border and the overdue word", () => {
    expect(page).toContain("border-rose");
    expect(page).toContain("· overdue");
  });
  test("search is client-side with matchesSearch; one green button per card links to the job", () => {
    expect(page).toContain("matchesSearch");
    expect(page).toContain("my-work.core");
    expect(page).toContain("greenBtn");
    expect(page).toMatch(/to="\/field\/\$jobId"/);
  });
  test("the old home pieces are gone", () => {
    for (const gone of ["installerHomeGroups", "offersListView", "monthStripWords", "ElectricianHome"]) expect(page).not.toContain(gone);
  });
  test("tradeHome returns myWork for installers", () => {
    expect(server).toContain("myWorkCards(");
    expect(server).toContain("myWork");
  });
});
