import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { OFFICE_HEADINGS, sectionFor } from "../src/config/office-nav";
import { officeLegacyTarget } from "../src/lib/legacy-links.core";
import { qaOfficeRouteAllowed } from "../src/lib/qa-office-policy.core";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("jobs routes, menu and old links", () => {
  test("Jobs menu entry opens Our jobs; all three pages sit under Jobs", () => {
    expect(OFFICE_HEADINGS.find((h) => h.key === "jobs")?.to).toBe("/admin/jobs/ours");
    for (const p of ["/admin/jobs/ours", "/admin/jobs/installers", "/admin/jobs/closed"]) expect(sectionFor(p)).toBe("jobs");
  });

  test("old /admin/jobs/active redirects to Our jobs keeping ?stage=", () => {
    const src = readFileSync("src/routes/_authenticated/admin.jobs.active.tsx", "utf8");
    expect(src).toContain("beforeLoad");
    expect(src).toContain('to: "/admin/jobs/ours"');
    expect(src).toContain("replace: true");
    expect(src).toMatch(/stage/);
    expect(src).toContain("JOBS_STAGE_KEYS");
  });

  test("Our jobs route validates ?stage= and passes it on", () => {
    const src = readFileSync("src/routes/_authenticated/admin.jobs.ours.tsx", "utf8");
    expect(src).toContain("JOBS_STAGE_KEYS");
    expect(src).toContain('lane="ours"');
    expect(src).toContain("initialStage={stage}");
    expect(readFileSync("src/routes/_authenticated/admin.jobs.installers.tsx", "utf8")).toContain('lane="installer"');
  });

  test("legacy links land on Our jobs", () => {
    expect(officeLegacyTarget("board")).toEqual({ to: "/admin/jobs/ours" });
    expect(officeLegacyTarget("board", { tab: "quotes" })).toEqual({ to: "/admin/jobs/ours", search: { stage: "quote" } });
    expect(officeLegacyTarget("list")).toEqual({ to: "/admin/jobs/ours" });
    expect(officeLegacyTarget("pipeline")).toEqual({ to: "/admin/jobs/ours" });
    expect(officeLegacyTarget("operations-preview")).toEqual({ to: "/admin/jobs/ours" });
    expect(officeLegacyTarget("quotes")).toEqual({ to: "/admin/jobs/ours", search: { stage: "quote" } });
    expect(officeLegacyTarget("ap-queue")).toEqual({ to: "/admin/jobs/ours", search: { stage: "final_check" } });
    expect(officeLegacyTarget("operations", { category: "active" })).toEqual({ to: "/admin/jobs/ours" });
  });

  test("TEST office may open Our jobs and Installer jobs", () => {
    expect(qaOfficeRouteAllowed("/admin/jobs/ours")).toBe(true);
    expect(qaOfficeRouteAllowed("/admin/jobs/installers")).toBe(true);
    expect(qaOfficeRouteAllowed("/admin/jobs/active")).toBe(true);
  });

  test("nothing in src still links to /admin/jobs/active except the redirect route", () => {
    const hits = sourceFiles("src").filter((f) => !f.endsWith("routeTree.gen.ts") && !f.endsWith("admin.jobs.active.tsx") && !f.endsWith("qa-office-policy.core.ts") && readFileSync(f, "utf8").includes("/admin/jobs/active"));
    expect(hits).toEqual([]);
  });
});
