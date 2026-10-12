import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("../scripts/test-isolated.ts", import.meta.url), "utf8");

describe("test runner Supabase isolation", () => {
  test("isolated test runner overrides Supabase env to local-only values", () => {
    expect(runner).toContain('SUPABASE_URL: "http://127.0.0.1:54321"');
    expect(runner).toContain('VITE_SUPABASE_URL: "http://127.0.0.1:54321"');
    expect(runner).toContain('SUPABASE_PROJECT_ID: "local-test-isolated"');
    expect(runner).toContain('VITE_SUPABASE_PROJECT_ID: "local-test-isolated"');
    expect(runner).toContain('SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test_isolated"');
    expect(runner).toContain('SUPABASE_SERVICE_ROLE_KEY: "sb_secret_local_test_isolated"');
  });

  test("isolated test runner removes production opt-in flag from child processes", () => {
    expect(runner).toContain("delete isolatedEnv.ALLOW_PROD_SUPABASE");
    expect(runner).toMatch(/Bun\.spawn\(\["bun", "test", "--timeout", "30000", f\], \{[^}]*env: isolatedEnv/s);
  });
});
