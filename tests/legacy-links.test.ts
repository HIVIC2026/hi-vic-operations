import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { OFFICE_HOME_FALLBACK, RETIRED_OFFICE_SLUGS, officeLegacyTarget, partnerLegacyTarget, publicLegacyTarget } from "../src/lib/legacy-links.core";

// Jo 27 Oct 2026: retired pages no longer get their own route file (they cluttered Lovable's page picker); old addresses
// still land on today's page through one table and a catch-all route per area.
describe("retired page addresses", () => {
  test("every retired office address lands on a live office page", () => {
    const tree = readFileSync("src/routeTree.gen.ts", "utf8");
    for (const slug of RETIRED_OFFICE_SLUGS) {
      expect(existsSync(`src/routes/_authenticated/admin.${slug}.tsx`)).toBe(false);
      const t = officeLegacyTarget(slug)!;
      expect(tree).toContain(`'${t.to}'`);
    }
  });
  test("search-dependent office redirects keep their old meaning", () => {
    expect(officeLegacyTarget("operations", { category: "active" })).toEqual({ to: "/admin/jobs/active" });
    expect(officeLegacyTarget("operations", { category: "closed" })).toEqual({ to: "/admin/jobs/closed" });
    expect(officeLegacyTarget("operations")).toEqual({ to: "/admin/enquiries" });
    expect(officeLegacyTarget("enquiry-groups", { status: "photos" })).toEqual({ to: "/admin/enquiries", search: { status: "photos" } });
    expect(officeLegacyTarget("enquiry-groups", { status: "nonsense" })).toEqual({ to: "/admin/enquiries", search: { status: "all" } });
    expect(officeLegacyTarget("compliance")).toEqual({ to: "/admin/settings", search: { tab: "templates" } });
    expect(officeLegacyTarget("ap-queue")).toEqual({ to: "/admin/jobs/active", search: { stage: "final_check" } });
    expect(officeLegacyTarget("/workers/")).toEqual({ to: "/admin/partners", search: { tab: "people" } });
  });
  test("unknown addresses are not invented", () => {
    expect(officeLegacyTarget("toString")).toBeNull();
    expect(officeLegacyTarget("needs-me-typo")).toBeNull();
    expect(OFFICE_HOME_FALLBACK).toEqual({ to: "/admin/needs-me" });
    expect(partnerLegacyTarget("workers")).toBeNull();
    expect(publicLegacyTarget("anything-else")).toBeNull();
  });
  test("retired partner and public pages land on their replacements", () => {
    expect(partnerLegacyTarget("add")).toEqual({ to: "/partner/import" });
    expect(partnerLegacyTarget("payments")).toEqual({ to: "/field/money" });
    expect(partnerLegacyTarget("profile")).toEqual({ to: "/field/business" });
    expect(publicLegacyTarget("installer-preview")).toEqual({ to: "/partner/import" });
    expect(publicLegacyTarget("campaign-preview")).toEqual({ to: "/" });
  });
  test("one catch-all route per area serves the table", () => {
    expect(readFileSync("src/routes/_authenticated/admin.$.tsx", "utf8")).toContain("officeLegacyTarget(params._splat");
    expect(readFileSync("src/routes/_authenticated/partner.$.tsx", "utf8")).toContain("partnerLegacyTarget(params._splat");
    const pub = readFileSync("src/routes/$.tsx", "utf8");
    expect(pub).toContain("publicLegacyTarget(params._splat");
    expect(pub).toContain("throw notFound()");
  });
});
