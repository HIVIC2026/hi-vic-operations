import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/_authenticated/field.index.tsx", "utf8");
const server = readFileSync("src/lib/trade-view.server.ts", "utf8");

describe("Home page (installer)", () => {
  // Installer redesign (plan Task 6): the page is now Action items; these replace the old My work heading/tab/card checks.
  test("Action items: greeting, sub line and the approved search words", () => {
    for (const w of ["home.greeting", "ai.sub", "Search name, address or HV number"]) expect(page).toContain(w);
  });
  test("deadline chips read 'By {date}' and overdue rows get a red border and the overdue word", () => {
    const core = readFileSync("src/lib/action-items.core.ts", "utf8");
    expect(core).toContain("`By ${niceDate(r.box.bookBy)}`");
    expect(page).toContain("border-rose");
    expect(page).toContain('" · overdue"');
  });
  test("search is client-side; every row links to the job", () => {
    expect(page).toContain("const hit = ");
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
