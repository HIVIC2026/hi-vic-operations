// STEP 73 (W4, A3): installer intake-progress read — authorization is enforced server-side BEFORE the job is read.
// On e28830c0 the STEP 71 guard read the job with the service-role client and answered { applies: false } before any
// access check, so any signed-in user (another business's installer, another customer) got an answer for any job id
// and could tell installer-sourced jobs from others. These tests pin the corrected order with an injected rpc
// (no live Supabase): access -> non-intake guard -> supplying-installer check.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { intakeProgressGate, type AccessRpc } from "../src/lib/installer-progress.core";

const HIV_JOB = { channel: "hivic_sourced", originating_installer_business_id: null };
const INTAKE_JOB = { channel: "installer_sourced", originating_installer_business_id: "biz-installer-1" };

function harness(access: { data: unknown; error?: unknown }, job: typeof HIV_JOB | typeof INTAKE_JOB | null) {
  const calls: string[] = [];
  let reads = 0;
  const rpc: AccessRpc = async (fn) => { calls.push(fn); return fn === "can_access_job" ? access : { data: null }; };
  const loadJob = async () => { reads++; return job; };
  return { rpc, loadJob, calls, reads: () => reads };
}

describe("positive: callers with job access", () => {
  test("assigned installer on a Home Insulation Victoria-sourced job: 'does not apply', no supplying-business check", async () => {
    const h = harness({ data: true }, HIV_JOB);
    expect(await intakeProgressGate(h.rpc, h.loadJob, "job-a")).toEqual({ applies: false });
    expect(h.calls).toEqual(["can_access_job"]);
    expect(h.reads()).toBe(1);
  });
  test("assigned installer on an installer-sourced intake job: applies (the handler then runs requireSupplyingInstaller)", async () => {
    const h = harness({ data: true }, INTAKE_JOB);
    expect(await intakeProgressGate(h.rpc, h.loadJob, "job-a")).toEqual({ applies: true });
  });
  test("installer-sourced job with no originating business: does not apply (STEP 71 behaviour kept)", async () => {
    const h = harness({ data: true }, { channel: "installer_sourced", originating_installer_business_id: null } as never);
    expect(await intakeProgressGate(h.rpc, h.loadJob, "job-a")).toEqual({ applies: false });
  });
});

describe("negative: callers without job access learn nothing", () => {
  for (const [label, job] of [["HIV-sourced", HIV_JOB], ["installer-sourced", INTAKE_JOB], ["missing", null]] as const) {
    test(`unassigned / other-business caller on a ${label} job is refused BEFORE the job is read`, async () => {
      const h = harness({ data: false }, job);
      await expect(intakeProgressGate(h.rpc, h.loadJob, "job-b")).rejects.toThrow("Not your job.");
      expect(h.reads()).toBe(0);
    });
  }
  test("an rpc error (e.g. RLS/session failure) is a denial, not 'does not apply'", async () => {
    const h = harness({ data: null, error: { message: "permission denied" } }, HIV_JOB);
    await expect(intakeProgressGate(h.rpc, h.loadJob, "job-a")).rejects.toThrow("Not your job.");
    expect(h.reads()).toBe(0);
  });
  test("a null access answer is a denial", async () => {
    const h = harness({ data: null }, HIV_JOB);
    await expect(intakeProgressGate(h.rpc, h.loadJob, "job-a")).rejects.toThrow("Not your job.");
  });
});

describe("server function source (getMyIntakeProgress)", () => {
  const src = readFileSync("src/lib/installer-quote.functions.ts", "utf8");
  const block = src.slice(src.indexOf("export const getMyIntakeProgress"), src.indexOf("export const", src.indexOf("export const getMyIntakeProgress") + 10));
  test("uses the caller's RLS-scoped client for the access check (context.supabase), not the service-role client", () => {
    expect(block).toContain("(context.supabase as unknown as { rpc: AccessRpc }).rpc(fn, args)");
  });
  test("the access gate runs before any job read and before the non-intake early return", () => {
    const gate = block.indexOf("await intakeProgressGate(");
    expect(gate).toBeGreaterThan(0);
    expect(block.indexOf("return { applies: false as const }")).toBeGreaterThan(gate);
    expect(block.indexOf("requireSupplyingInstaller(")).toBeGreaterThan(gate);
    // the only jobs read before the gate is the loader handed TO the gate
    const before = block.slice(0, gate);
    expect(before).not.toContain('admin.from("jobs")');
  });
  test("intake jobs still require the supplying-installer check (installer role + business membership)", () => {
    expect(block).toContain("await requireSupplyingInstaller(context.supabase as never, context.userId, data.jobId);");
    expect(src).toMatch(/async function requireSupplyingInstaller[\s\S]*?can_access_job[\s\S]*?has_role[\s\S]*?is_business_member/);
  });
});
