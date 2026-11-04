import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { OLD_FLOW_STEPS_P3 } from "../src/lib/old-flow-steps.core";

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("template hub has no entry for the removed pre-acceptance messages", () => {
  const bad = TEMPLATE_ENTRIES.filter((e) =>
    ["O75", "O11", "O12"].includes(e.code) || /Just checking/i.test(e.name) || /renderFollowupEmail/.test(e.source.fn)
    || ["ready_check_times_owner", "ready_check_booked_owner", "run_time", "run_time_reminder"].some((t) => e.gate.kind === "text" && e.gate.smsType === t)
    || /^owner:sms-(ready_check_times_owner|ready_check_booked_owner|run_time)/.test(e.id));
  expect(bad.map((e) => e.id)).toEqual([]);
});

test("retired text types keep their key but can never send", () => {
  for (const k of ["ready_check_times_owner", "ready_check_booked_owner", "run_time", "run_time_reminder"] as const) {
    const t = SMS_MESSAGE_TYPES[k];
    expect(t).toBeDefined();
    expect(t.wordingApproved).toBe(false);
    expect(t.label.startsWith("Retired 2 Nov 2026 —")).toBe(true);
  }
});

test("no owner screen asks the owner to pick a Ready Check time up front", () => {
  const files = ["src/components/owner/OwnerReadyCheckTimes.tsx", "src/components/owner/OwnerRunTime.tsx", "src/components/portal/estimate.tsx", "src/routes/my-job.$token.tsx"];
  for (const f of files.filter(existsSync)) {
    const c = code(f);
    expect(c).not.toMatch(/offer you 3 times/i);
    expect(c).not.toMatch(/pick a time/i);
    expect(c).not.toMatch(/Wrong time/i);
  }
});

test("a job that is mid-way through an old step still gets its old screen (only when it is at that step)", () => {
  const c = code("src/components/owner/OwnerReadyCheckTimes.tsx");
  expect(c).toContain('data.turn !== "owner_to_answer"');
  expect(c).not.toContain('data-owner-rc-times="waiting"');
  expect(existsSync("src/components/owner/OwnerRunTime.tsx")).toBe(true);
});

test("no sweep sends the unopened follow-up or the signed-paperwork copy", () => {
  expect(existsSync("src/lib/followup-email.ts")).toBe(false);
  expect(existsSync("src/lib/paperwork-copy-email.server.ts")).toBe(false);
  expect(existsSync("src/lib/paperwork-copy-email.core.ts")).toBe(false);
  expect(existsSync("src/lib/ready-check-times-email.server.ts")).toBe(false);
  expect(existsSync("src/lib/ready-check-booked-email.server.ts")).toBe(false);
  expect(code("src/lib/followups.server.ts")).not.toContain("renderFollowupEmail");
  expect(code("src/routes/api/public/hooks/allocation-tick.ts")).not.toMatch(/sweepOwnerPaperworkCopies|paperwork-copy-email/);
  expect(code("src/lib/ready-check-times.server.ts")).not.toMatch(/ready-check-times-email\.server|ready-check-booked-email\.server/);
});

test("old step list covers the pick-a-time steps and the script is read-only", () => {
  const steps = OLD_FLOW_STEPS_P3.map((s) => s.step);
  expect(steps).toContain("owner picking Ready Check times");
  expect(steps).toContain("owner confirming a run window");
  for (const s of OLD_FLOW_STEPS_P3) { expect(s.stages.length + s.events.length).toBeGreaterThan(0); }
  const script = code("scripts/old-flow-inflight-count.ts");
  expect(script).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  expect(script).toContain("oldStepJobs");
  const reader = code("src/lib/old-flow-inflight.server.ts");
  expect(reader).not.toMatch(/\.(insert|update|delete|upsert|rpc)\(/);
  expect(reader).toContain("OLD_FLOW_STEPS_P3");
});
