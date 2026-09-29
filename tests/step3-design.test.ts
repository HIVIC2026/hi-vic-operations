import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/_authenticated/admin.step3-design.tsx", "utf8");
const navigation = readFileSync("src/components/portal/AppShell.tsx", "utf8");
const publicPage = readFileSync("src/routes/step3-design-preview.tsx", "utf8");
const fixtures = readFileSync("src/lib/step3-design-fixtures.ts", "utf8");

describe("Step 3 design review", () => {
  test("admin role is checked before the sample page loads", () => {
    expect(page).toContain('createFileRoute("/_authenticated/admin/step3-design")');
    expect(page).toContain('supabase.rpc("is_admin")');
    expect(page).toContain('if (error || data !== true) throw redirect');
    expect(navigation).toContain('to="/admin/step3-design"');
  });

  test("the public route reuses the real header and estimate without a login or data calls", () => {
    expect(publicPage).toContain('createFileRoute("/step3-design-preview")');
    expect(publicPage).toContain("<EstimateHeader />");
    expect(publicPage).toContain("<CustomerEstimate data={fixtures.knownData} publicPage />");
    expect(publicPage).toContain("<CustomerEstimate data={fixtures.unknownData} publicPage />");
    expect(publicPage).toContain("DESIGN PREVIEW ONLY — sample data, nothing is saved.");
    expect(publicPage).not.toMatch(/beforeLoad|useServerFn|createServerFn|supabase|\.from\(|getPublicEstimate|\$token/);
  });

  test("both examples share static sample values without writes", () => {
    expect(page).toContain("<CustomerEstimate data={knownData} />");
    expect(page).toContain("<CustomerEstimate data={unknownData} />");
    expect(fixtures).toContain('m2: 134.1');
    expect(fixtures).toContain('lookupLocation("3058")');
    expect(fixtures).toContain('computeEstimate(area, location, "present", sampleSettings)');
    expect(fixtures).toContain('insulation: "none"');
    expect(fixtures).not.toMatch(/\.from\(|\.insert\(|\.update\(|getAdminEstimate|createServerFn|supabase/);
  });
});