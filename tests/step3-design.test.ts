import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const page = readFileSync("src/routes/_authenticated/admin.step3-design.tsx", "utf8");
const navigation = readFileSync("src/components/portal/AppShell.tsx", "utf8");

describe("Step 3 design review", () => {
  test("admin role is checked before the sample page loads", () => {
    expect(page).toContain('createFileRoute("/_authenticated/admin/step3-design")');
    expect(page).toContain('supabase.rpc("is_admin")');
    expect(page).toContain('if (error || data !== true) throw redirect');
    expect(navigation).toContain('to="/admin/step3-design"');
  });

  test("both examples reuse the customer view with local sample values only", () => {
    expect(page).toContain("<CustomerEstimate data={knownData} />");
    expect(page).toContain("<CustomerEstimate data={unknownData} />");
    expect(page).toContain('m2: 134.1');
    expect(page).toContain('computeEstimate(area, location, "present", sampleSettings)');
    expect(page).toContain('insulation: "none"');
    expect(page).not.toMatch(/\.from\(|\.insert\(|\.update\(|getAdminEstimate|createServerFn/);
  });
});