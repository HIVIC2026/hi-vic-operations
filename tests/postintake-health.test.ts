// Static assertions for the admin post-intake health panel (Step 1 -> Step 2 worker observability).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

const adminPage = readFileSync("src/routes/_authenticated/admin.index.tsx", "utf8");
const fns = readFileSync("src/lib/portal.functions.ts", "utf8");
const server = readFileSync("src/lib/postintake.server.ts", "utf8");
const route = readFileSync("src/routes/api/public/hooks/post-intake.ts", "utf8");

describe("post-intake health panel", () => {
  it("server fn is admin-only and delegates to postintake.server", () => {
    expect(fns).toContain("export const getPostIntakeHealth");
    expect(fns).toMatch(/getPostIntakeHealth[\s\S]*?requireAdmin\(context\.supabase\)/);
    expect(fns).toContain("postIntakeHealth()");
  });
  it("health snapshot counts queued, running, stale and failed work", () => {
    for (const k of ["queued", "running", "stale", "failed"]) expect(server).toContain(`counts.${k}++`);
    expect(server).toContain("lease_expires_at < now"); // stale = processing past its lease
    expect(server).toContain("post_intake_worker"); // last worker run source
  });
  it("worker route records each run (success and failure)", () => {
    expect(route).toContain("recordWorkerRun");
    expect((route.match(/recordWorkerRun/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("admin pipeline renders the panel with counts and last run time", () => {
    expect(adminPage).toContain('data-testid="post-intake-health"');
    expect(adminPage).toContain("getPostIntakeHealth");
    for (const label of ["Queued", "Running", "Stale", "Failed"]) expect(adminPage).toContain(label);
  });
});
