// Jo 4 Nov 2026 19:35 (G6): the installer "My electricians" page is RETIRED — Team (/field/business/team) is the only way to
// add an electrician. The route, the component, the My business link and the installer-side server functions are gone;
// every line that pointed at "My electricians" now says "Add them on the Team page". The office approve / reject card on
// the Partners page, the data tables and main's Part 2 own-job links stay.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { rejectionEmail } from "../src/lib/my-electricians.core";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("My electricians page retired", () => {
  test("route file, component and route-tree entry are gone; My business no longer links to it", () => {
    expect(existsSync(new URL("../src/routes/_authenticated/field.business_.electricians.tsx", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/components/trade/my-electricians.tsx", import.meta.url))).toBe(false);
    expect(src("src/routeTree.gen.ts")).not.toContain("/field/business/electricians");
    const biz = src("src/routes/_authenticated/field.business.tsx");
    expect(biz).not.toContain("/field/business/electricians");
    expect(biz).not.toContain('title="My electricians"');
    expect(biz).toContain('to="/field/business/team"'); // Team stays the one way in
  });
  test("the installer-side server functions went with the page; the office ones stay", () => {
    const fns = src("src/lib/my-electricians.functions.ts");
    for (const gone of ["getMyElectricians", "getMyElectricianUploadUrl", "addMyElectrician", "getMyElectricianDetails", "resubmitMyElectrician"]) expect(fns).not.toContain(`export const ${gone} `);
    for (const kept of ["getInstallerElectricianReview", "approveInstallerElectrician", "rejectInstallerElectrician"]) expect(fns).toContain(`export const ${kept} `);
  });
  test("no copy points at My electricians any more; the rejection email says to add them on the Team page", () => {
    for (const f of ["src/lib/my-electricians.core.ts", "src/lib/my-electricians.server.ts", "src/lib/template-hub.core.ts", "src/routes/_authenticated/admin.partners_.business.$businessId.tsx"]) {
      expect(src(f).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""), f).not.toMatch(/in My electricians|under My electricians/);
    }
    expect(rejectionEmail({ electricianName: "Rita Relay", reason: "Blurry licence photo" }).message).toBe("Rita Relay wasn't approved: Blurry licence photo. Add them on the Team page.");
  });
});
