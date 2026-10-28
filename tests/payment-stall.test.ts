// Jo 28 Oct 2026 (decision card 04:40 UTC): "Alert after 3 days unpaid" — pure rules for the ONE office row per job.
import { describe, expect, test } from "bun:test";
import { PAYMENT_STALL_DAYS, STALLED_STEPS, paymentStall, paymentStallLine } from "../src/lib/payment-stall.core";

const NOW = Date.parse("2026-10-28T04:00:00Z");
const daysAgo = (n: number, h = 0) => new Date(NOW - n * 86_400_000 - h * 3_600_000).toISOString();

describe("paymentStall", () => {
  test("an unpaid safety check 3 days old raises the alert", () => {
    const s = paymentStall([{ key: "safety_check", since: daysAgo(3) }], NOW);
    expect(s).toEqual({ key: "safety_check", since: daysAgo(3), days: 3 });
  });

  test("2 days 23 hours is not yet 3 days", () => {
    expect(paymentStall([{ key: "safety_check", since: daysAgo(2, 23) }], NOW)).toBeNull();
  });

  test("an unpaid install deposit 5 days old raises the alert", () => {
    expect(paymentStall([{ key: "install_deposit", since: daysAgo(5) }], NOW)?.key).toBe("install_deposit");
  });

  test("unpaid fixes and repeat safety check are covered", () => {
    expect(paymentStall([{ key: "fixes", since: daysAgo(4) }], NOW)?.key).toBe("fixes");
    expect(paymentStall([{ key: "repeat_safety_check", since: daysAgo(4) }], NOW)?.key).toBe("repeat_safety_check");
  });

  test("the balance is never covered (due on install day)", () => {
    expect(STALLED_STEPS).not.toContain("balance");
    expect(paymentStall([{ key: "balance", since: daysAgo(10) }], NOW)).toBeNull();
  });

  test("several unpaid steps give exactly ONE row: the one waiting longest", () => {
    const s = paymentStall([
      { key: "install_deposit", since: daysAgo(4) },
      { key: "safety_check", since: daysAgo(9) },
      { key: "fixes", since: daysAgo(6) },
    ], NOW);
    expect(s?.key).toBe("safety_check");
    expect(s?.days).toBe(9);
  });

  test("no unpaid steps (payment recorded) → no row", () => {
    expect(paymentStall([], NOW)).toBeNull();
  });

  test("the line names the payment and the date it has been unpaid since", () => {
    const line = paymentStallLine({ key: "install_deposit", since: "2026-10-24T05:00:00Z", days: 3 });
    expect(line).toContain("Install deposit (10%)");
    expect(line).toContain("unpaid since");
    expect(line).toContain("Sat, 24 Oct");
    expect(PAYMENT_STALL_DAYS).toBe(3);
  });
});
