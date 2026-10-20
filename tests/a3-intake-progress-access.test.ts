// STEP 73 (W4, A3): installer intake-progress read — authorization is enforced server-side BEFORE the job is read.
// bdf1da3c replaced the separate intakeProgressGate helper with requireJobInstaller (caller's RLS-scoped
// can_access_job + installer role) at the top of getMyIntakeProgress. These tests pin that current order on the actual
// handler source: access -> non-intake guard -> supplying-installer check, and that an rpc error/null is a denial.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = readFileSync("src/lib/installer-quote.functions.ts", "utf8");
const start = src.indexOf("export const getMyIntakeProgress");
const block = src.slice(start, src.indexOf("export const", start + 10));
const jobInstaller = src.slice(src.indexOf("async function requireJobInstaller"), src.indexOf("async function requireSupplyingInstaller"));

describe("access check (requireJobInstaller)", () => {
  test("uses the caller's RLS-scoped client and can_access_job", () => {
    expect(block).toContain("await requireJobInstaller(context.supabase as never, context.userId, data.jobId);");
    expect(jobInstaller).toContain('sb.rpc("can_access_job", { _job: jobId })');
  });
  test("an rpc error OR a null/false answer is a denial, never 'does not apply'", () => {
    expect(jobInstaller).toContain('if (error || !ok) throw new Error("Not your job.");');
  });
  test("non-installers are refused", () => {
    expect(jobInstaller).toMatch(/has_role[\s\S]*_role: "installer"[\s\S]*if \(!inst\) throw/);
  });
});

describe("order inside getMyIntakeProgress", () => {
  const gate = block.indexOf("await requireJobInstaller(");
  test("access runs before the intake check, the non-intake early return and any service-role read", () => {
    expect(gate).toBeGreaterThan(0);
    expect(block.indexOf("isIntakeJob(")).toBeGreaterThan(gate);
    expect(block.indexOf("return { applies: false as const }")).toBeGreaterThan(gate);
    expect(block.slice(0, gate)).not.toContain('admin.from(');
    expect(block.slice(0, gate)).not.toContain("client.server");
  });
  test("intake jobs additionally require the supplying-installer check before reading job data", () => {
    const sup = block.indexOf("await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);");
    expect(sup).toBeGreaterThan(block.indexOf("return { applies: false as const }"));
    expect(sup).toBeLessThan(block.indexOf('admin.from("jobs")'));
    expect(src).toMatch(/async function requireSupplyingInstaller[\s\S]*?requireJobInstaller[\s\S]*?is_business_member/);
  });
});
