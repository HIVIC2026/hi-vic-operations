import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEAD_ORIGINS, LEAD_ORIGIN_BLOCKED, LEAD_ORIGIN_MISSING, leadOriginProblem } from "../src/lib/onsite-ready-check.core";
import { fieldErrors } from "../src/lib/add-job-flow.core";

test("A1: four choices; door-knock and cold call refused; an answer is required", () => {
  expect(LEAD_ORIGINS.map((o) => o.value)).toEqual(["owner_contacted", "referral", "door_knock", "cold_call"]);
  expect(leadOriginProblem("owner_contacted")).toBeNull();
  expect(leadOriginProblem("referral")).toBeNull();
  expect(leadOriginProblem("door_knock")).toBe(LEAD_ORIGIN_BLOCKED);
  expect(leadOriginProblem("cold_call")).toBe(LEAD_ORIGIN_BLOCKED);
  expect(leadOriginProblem(null)).toBe(LEAD_ORIGIN_MISSING);
  expect(fieldErrors([LEAD_ORIGIN_BLOCKED]).lead_origin).toBe(LEAD_ORIGIN_BLOCKED);
  expect(fieldErrors([LEAD_ORIGIN_MISSING]).lead_origin).toBe(LEAD_ORIGIN_MISSING);
});
test("A1: the server refuses before anything is saved and records the answer", () => {
  const srv = readFileSync("src/lib/onsite-ready-check.server.ts", "utf8");
  expect(srv).toContain("leadOriginProblem(opts.leadOrigin)");
  expect(srv.indexOf("leadOriginProblem(")).toBeLessThan(srv.indexOf("if (problems.length) throw"));
  expect(srv).toContain("lead_origin: opts.leadOrigin");
  const fn = readFileSync("src/lib/onsite-ready-check.functions.ts", "utf8");
  expect(fn).toContain('leadOrigin: z.enum(["owner_contacted", "referral", "door_knock", "cold_call"]).nullable().optional()');
  const ui = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
  expect(ui).toContain("data-lead-origin");
  expect(ui.indexOf("data-lead-origin")).toBeLessThan(ui.indexOf("data-owner-card"));
});
