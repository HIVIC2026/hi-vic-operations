import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
// The installer branch is the InstallerFlow function (the last function in the file).
const installer = src.slice(src.indexOf("function InstallerFlow"));
const idx = (needle: string, from = 0) => installer.indexOf(needle, from);

describe("installer Job page layout (jobA3-1/2)", () => {
  test("renders, in order: back link, owner + pill + HV number, progress, countdown, Next step box, folded rows, bottom links", () => {
    const order = [
      "‹ My work", "page.label", "job.job_number", "page.progress", "page.countdown.line", "<NextStepBox",
      'title="Owner"', 'title="Visits"', 'title="Site notes"', 'title="Job details"', 'title="What the owner\'s been told"', 'title="Paperwork"',
      "<ReturnActions",
    ];
    let at = -1;
    for (const n of order) {
      const found = idx(n, at + 1);
      expect(found, `${n} should come after the previous item`).toBeGreaterThan(at);
      at = found;
    }
  });
  test("folded rows are <details>", () => {
    expect(src).toContain("<details");
    expect(src).toMatch(/function Fold\(/);
  });
  test("the bottom links keep the guarded hand-back and owner-cancelled writers", () => {
    const card = readFileSync("src/components/trade/InHouseBookingCard.tsx", "utf8");
    expect(card).toContain("Can't do this one");
    expect(card).toContain("Owner cancelled");
    expect(card).toMatch(/export function ReturnActions/);
  });
  test("the old cards are gone from the installer page", () => {
    for (const gone of ["<InHouseBookingCard", "<A1ReadyCheckTimeCard", "<FixesTimesCard", "<OtherItems", "<InstallerReadyCheckTimesCard", "<InstallerInstallDays", "<ElectricianPiesaTimesCard", "<WhosDoingThis", "Send this job to a staff member", STAFF()]) {
      expect(installer, gone).not.toContain(gone);
    }
  });
  test("paperwork is view/download only: no upload control inside the Paperwork fold", () => {
    const paper = installer.slice(idx('title="Paperwork"'));
    expect(paper).not.toMatch(/type="file"|Upload/);
  });
});

function STAFF() {
  // The label constant that used to head the staff-links fold.
  return "STAFF_LINKS_LABEL";
}
