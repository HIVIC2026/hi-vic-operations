import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const enq00 = readFileSync("supabase/manual_sql/ENQ_00_RECONCILE_ALL.sql", "utf8");
const enq01 = readFileSync("supabase/manual_sql/ENQ_01_ENQUEUE_SAFE.sql", "utf8");

const FIRST = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready"];
const T7 = ["new_enquiry", "eligibility_review", "on_hold"];
const list = (s: string[]) => s.map((x) => `'${x}'`).join(", ");

type Route = "first" | "t7";
// Mirrors the stage predicate both scripts now contain (asserted textually below).
const selected = (route: Route, stage: string) =>
  (route === "first" ? FIRST : T7).includes(stage);

describe("backlog stage safety", () => {
  test("ENQ_01 gates each route by its exact stage list", () => {
    expect(enq01).toContain(`u.insulation_declared = 'none'\n          and u.stage in (${list(FIRST)})`);
    expect(enq01).toContain(`'does_not_appear_eligible'\n          and u.stage in (${list(T7)})`);
    expect(enq01).toContain(`and u.stage in (${list(FIRST)})\n          and m.media_docs = 0`);
    expect(enq01).not.toContain("not in ('complete', 'cancelled', 'on_hold')");
  });

  test("ENQ_00 predicts the same stage lists", () => {
    expect(enq00).toContain(`('A_ELIGIBLE_NO_INSULATION', 'C_INSULATION_UNKNOWN')\n        and c.stage not in (${list(FIRST)}) then 'STAGE_MOVED_ON'`);
    expect(enq00).toContain(`('A_ELIGIBLE_NO_INSULATION', 'C_INSULATION_UNKNOWN')\n        and c.stage not in (${list(FIRST)})\n        then 'HELD_BY_SENDER_RULE'`);
    expect(enq00).toContain(`'B_INELIGIBLE' and c.stage not in (${list(T7)}) then 'STAGE_MOVED_ON'`);
    expect(enq00).toContain(`'B_INELIGIBLE' and c.stage not in (${list(T7)})\n        then 'HELD_BY_SENDER_RULE'`);
  });

  test("cancelled / ready-check T1/T2 not selected; on_hold T7 selected; on_hold T6 not", () => {
    expect(selected("first", "cancelled")).toBe(false);
    expect(selected("first", "ready_check_ready_to_schedule")).toBe(false);
    expect(selected("first", "complete")).toBe(false);
    expect(selected("first", "on_hold")).toBe(false);
    expect(selected("t7", "on_hold")).toBe(true);
    expect(selected("t7", "cancelled")).toBe(false);
    expect(selected("first", "preliminary_estimate_ready")).toBe(true);
  });
});
