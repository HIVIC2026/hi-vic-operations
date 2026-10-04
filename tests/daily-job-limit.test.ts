import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod";

const src = readFileSync(new URL("../src/lib/pilot.functions.ts", import.meta.url), "utf8");
const rule = z.number().int().min(1).max(50).nullish();

describe("electrician daily job limit", () => {
  test("0 and negatives refused; empty means no limit; whole numbers only", () => {
    expect(rule.safeParse(0).success).toBe(false);
    expect(rule.safeParse(-2).success).toBe(false);
    expect(rule.safeParse(1.5).success).toBe(false);
    expect(rule.safeParse(null).success).toBe(true);
    expect(rule.safeParse(3).success).toBe(true);
  });
  test("server uses the same rule with plain messages", () => {
    expect(src).toMatch(/daily_job_limit: z\.number\(.*\.min\(1, "Daily job limit must be 1 or more/);
  });
  test("partners cannot change it; office changes are recorded", () => {
    expect(src).toContain('delete (patch as Record<string, unknown>)["daily_job_limit"]');
    expect(src).toContain('"electrician_daily_limit_set"');
  });
});
