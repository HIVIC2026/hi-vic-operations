import { describe, expect, test } from "bun:test";
import { RECOVERY_BACKOFF_MIN, RECOVERY_MAX_ATTEMPTS, nextAfterFailure } from "../src/lib/recovery-work.core";

const t = new Date("2026-11-05T00:00:00.000Z");
const plus = (min: number) => new Date(t.getTime() + min * 60_000).toISOString();

describe("recovery-work core", () => {
  test("constants", () => {
    expect(RECOVERY_BACKOFF_MIN).toEqual([5, 15, 30]);
    expect(RECOVERY_MAX_ATTEMPTS).toBe(3);
  });
  test("1st failure retries in 5 min", () => {
    expect(nextAfterFailure(0, t)).toEqual({ status: "open", nextAttemptAt: plus(5) });
  });
  test("2nd failure retries in 15 min", () => {
    expect(nextAfterFailure(1, t)).toEqual({ status: "open", nextAttemptAt: plus(15) });
  });
  test("3rd failure goes to the office", () => {
    expect(nextAfterFailure(2, t)).toEqual({ status: "needs_office", nextAttemptAt: null });
  });
});
