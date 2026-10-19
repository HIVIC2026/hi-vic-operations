import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HOT_EXCLUDED_JOBS, HOT_HIDDEN_DUPLICATES, legacyExclusionReason } from "../src/lib/hot-leads.core";

const enq00 = readFileSync("supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql", "utf8");
const enq01 = readFileSync("supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql", "utf8");
const router = readFileSync("src/lib/lead-email-routing.server.ts", "utf8");

function listOn(sql: string, marker: string): string[] {
  const line = sql.split("\n").filter((l) => l.includes(`-- ${marker}`));
  expect(line.length).toBe(1);
  return [...line[0].matchAll(/'(HV-\d+)'/g)].map((m) => m[1]).sort();
}
const sorted = (s: Set<string>) => [...s].sort();

describe("legacy exclusion lists", () => {
  test("ENQ_00 and ENQ_01 lists match the TS constants exactly", () => {
    for (const sql of [enq00, enq01]) {
      expect(listOn(sql, "LEGACY_EXCLUDED_LIST")).toEqual(sorted(HOT_EXCLUDED_JOBS));
      expect(listOn(sql, "HIDDEN_DUPLICATE_LIST")).toEqual(sorted(HOT_HIDDEN_DUPLICATES));
    }
  });

  test("ENQ_00 blocks listed jobs before any other category (never AUTO_SEND)", () => {
    const firstWhen = enq00.indexOf("when f.job_number in");
    expect(firstWhen).toBeGreaterThan(0);
    expect(firstWhen).toBeLessThan(enq00.indexOf("'F_ALREADY_RESPONDED'"));
    expect(enq00).toContain("'K_LEGACY_EXCLUDED'");
    expect(enq00).toContain("'K_HIDDEN_DUPLICATE'");
    // AUTO_SEND only comes from A/B/C categories, so K_* falls to BLOCKED.
    expect(enq00).toMatch(/when c\.category in \('A_ELIGIBLE_NO_INSULATION', 'B_INELIGIBLE', 'C_INSULATION_UNKNOWN'\)\s+then case when c\.failed_sends > 0 then 'AUTO_SEND_RETRY'/);
  });

  test("ENQ_01 excludes listed jobs with NOT IN before enqueue", () => {
    expect(enq01).toMatch(/and j\.job_number not in \([^)]*'HV-1257'[^)]*\) -- LEGACY_EXCLUDED_LIST/);
    expect(enq01).toMatch(/and j\.job_number not in \([^)]*'HV-1180'[^)]*\) -- HIDDEN_DUPLICATE_LIST/);
  });

  test("current AUTO_SEND risks are blocked", () => {
    for (const n of ["HV-1257", "HV-1291"]) expect(legacyExclusionReason(n)).toBe("LEGACY_EXCLUDED");
    for (const n of ["HV-1180", "HV-1225", "HV-1242", "HV-1286"]) expect(legacyExclusionReason(n)).toBe("HIDDEN_DUPLICATE");
  });

  test("ordinary unlisted jobs are unaffected", () => {
    for (const n of ["HV-1181", "HV-1371", "HV-1437", "", null, undefined]) expect(legacyExclusionReason(n)).toBeNull();
    for (const sql of [enq00, enq01]) {
      expect(listOn(sql, "LEGACY_EXCLUDED_LIST")).not.toContain("HV-1181");
      expect(listOn(sql, "HIDDEN_DUPLICATE_LIST")).not.toContain("HV-1181");
    }
  });

  test("router checks exclusion before selecting a route or calling any sender", () => {
    const body = router.slice(router.indexOf("export async function maybeAutoRouteLeadEmail"));
    const check = body.indexOf("legacyExclusionReason(");
    expect(check).toBeGreaterThan(0);
    for (const later of ["selectLeadEmailRoute(jobId)", "sendSaveMySpot", "sendAutomaticInsulationDetails", "sendDecisionIneligibleEmail"]) {
      const at = body.indexOf(later);
      if (at >= 0) expect(check).toBeLessThan(at);
    }
    expect(router).not.toMatch(/new Set\(\["HV-/); // constants reused, not duplicated
  });
});
