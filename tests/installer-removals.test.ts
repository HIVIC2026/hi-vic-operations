// Installer screens Task 11: the "How it works" tab, the old four-form booking card (with "Rectification"), the unused
// Team electrician picker and the installer guide words are gone; old /field/guide bookmarks land on My work.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const SRC = walk("src");
const SCRIPTS = walk("scripts");

describe("files that no longer exist", () => {
  test("the old booking card and the unused Team electrician picker are deleted", () => {
    for (const f of ["src/components/trade/InHouseBookingCard.tsx", "src/components/trade/TeamElectricianPicker.tsx"]) expect(existsSync(f), f).toBe(false);
  });
  test("the guide screen is gone: field.guide.tsx is a redirect-only route to /field (old bookmarks and the welcome email link still land)", () => {
    const page = read("src/routes/_authenticated/field.guide.tsx");
    expect(page).toContain('redirect({ to: "/field", replace: true })');
    expect(page).toContain("component: () => null");
    for (const gone of ["GUIDE_STEPS", "GUIDE_WORDS", "guideTabTitle", "ELECTRICIAN_GUIDE", "getTradeBusiness", "TradeShell"]) expect(page).not.toContain(gone);
  });
});

describe("no source file still points at the removed pieces", () => {
  test("no import of InHouseBookingCard or TeamElectricianPicker; no link to /field/guide inside the portal", () => {
    for (const f of [...SRC, ...SCRIPTS]) {
      const s = read(f);
      expect(s, f).not.toMatch(/from ["'][^"'\n]*(InHouseBookingCard|TeamElectricianPicker)["']/);
      if (f.endsWith(".tsx")) expect(s, f).not.toMatch(/to="\/field\/guide"/);
    }
  });
  test("the installer guide words are gone from trade-view.core; the electrician guide words stay for Part 6", () => {
    const core = read("src/lib/trade-view.core.ts");
    for (const gone of ["export const GUIDE_STEPS", "export const GUIDE_WORDS", "export function guideTabTitle", "How every job works\",\n  sub: \"Two minutes"]) expect(core).not.toContain(gone);
    expect(core).toContain("export const ELECTRICIAN_GUIDE_STEPS");
    expect(core).toContain("export const ELECTRICIAN_GUIDE_WORDS");
  });
  test("no \"Rectification\" on any trade component or field route; no \"How it works\" tab", () => {
    const files = [...SRC.filter((f) => f.startsWith("src/components/trade/")), ...SRC.filter((f) => /^src\/routes\/_authenticated\/field/.test(f))];
    for (const f of files) {
      const s = read(f);
      expect(s, f).not.toMatch(/\bRectification\b/);
      expect(s, f).not.toMatch(/How it works|How every job works/);
    }
    expect(read("src/routes/_authenticated/field.welcome.tsx")).not.toContain("/field/guide");
  });
  test("the installer Job page keeps the guarded hand-back / owner-cancelled writers (ReturnActions moved, not removed)", () => {
    const job = read("src/routes/_authenticated/field.$jobId.tsx");
    expect(job).toContain('from "@/components/trade/ReturnActions"');
    expect(job).toContain("<ReturnActions");
    const ra = read("src/components/trade/ReturnActions.tsx");
    expect(ra).toContain("export function ReturnActions");
    expect(ra).toContain("export function useInHouseBookingAccess");
    expect(ra).toContain("tradeHandBack");
    expect(ra).toContain("tradeOwnerCancelled");
    expect(read("src/components/trade/NextStepBox.tsx")).toContain('from "@/components/trade/ReturnActions"');
  });
  test("the job page no longer imports the time-offer cards the Next step box replaced", () => {
    const job = read("src/routes/_authenticated/field.$jobId.tsx");
    for (const gone of ["InstallerInstallDays", "useInstallerInstallDays", "InstallerReadyCheckTimesCard", "useInstallerReadyCheckTimes", "<InHouseBookingCard"]) expect(job, gone).not.toContain(gone);
  });
});

describe("the rule is written down", () => {
  test("workflow decisions + source of truth say: one Next step box, no How it works tab", () => {
    expect(read("src/config/workflow-decisions.ts")).toMatch(/one Next step box; no How it works tab/);
    expect(read("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md")).toMatch(/one Next step box; no How it works tab/);
  });
});
