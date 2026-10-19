import { describe, expect, test } from "bun:test";
import { jobTimeline, paymentDates, type StatusFacts } from "../src/lib/job-status.core";
const base: StatusFacts = { stage: "installation_booked", stageSince: null, now: new Date("2026-10-08T00:00:00Z"), staff: false, bookings: [], quoteSentAt: null, quoteAcceptedAt: null, safetyPaidAt: null, ownerTimesChosenAt: null, rectQuoteSentAt: null, paidInFullAt: null, apApprovedAt: null, safetyPay: { kind: "unknown" }, payout: null };
/** Facts assembled the way job-status.server.ts assembles them: a recorded payment row is a paid state. */
const withPay = (pd: { safetyPaidAt: string | null }) => ({ ...base, ...pd, safetyPay: pd.safetyPaidAt ? { kind: "paid" as const, paidAt: pd.safetyPaidAt } : { kind: "unknown" as const } });
describe("payment dates on the timeline", () => {
  test("first 50% ticks when the deposit is paid, not at full payment", () => {
    const pd = paymentDates([{ kind: "installation", status: "deposit_paid", deposit_paid_at: "2026-10-02T01:00:00Z", balance_paid_at: null, paid_at: null }], [{ paid_at: "2026-09-28T01:00:00Z" }]);
    expect(pd).toMatchObject({ safetyPaidAt: "2026-09-28T01:00:00Z", firstHalfPaidAt: "2026-10-02T01:00:00Z", finalHalfPaidAt: null });
    const t = jobTimeline({ ...withPay(pd), paidInFullAt: pd.finalHalfPaidAt });
    expect(t.find((s) => s.key === "safety_paid")).toMatchObject({ state: "done", date: "2026-09-28T01:00:00Z" });
    expect(t.find((s) => s.key === "first_half")).toMatchObject({ state: "done", date: "2026-10-02T01:00:00Z" });
    expect(t.find((s) => s.key === "final_half")?.state).not.toBe("done");
  });
  test("full payment and fix costs each show their own date", () => {
    const pd = paymentDates([
      { kind: "installation", status: "fully_paid", deposit_paid_at: "2026-10-02T01:00:00Z", balance_paid_at: "2026-10-06T01:00:00Z", paid_at: "2026-10-06T01:00:00Z" },
      { kind: "rectification", status: "fully_paid", deposit_paid_at: null, balance_paid_at: null, paid_at: "2026-09-30T01:00:00Z" },
    ], []);
    const t = jobTimeline({ ...withPay(pd), paidInFullAt: pd.finalHalfPaidAt });
    expect(t.find((s) => s.key === "first_half")?.date).toBe("2026-10-02T01:00:00Z");
    expect(t.find((s) => s.key === "final_half")?.date).toBe("2026-10-06T01:00:00Z");
    expect(t.find((s) => s.key === "fixes_paid")).toMatchObject({ state: "done", date: "2026-09-30T01:00:00Z" });
  });
  test("fix costs step is 'Not needed' when no fixes", () => {
    expect(jobTimeline(base).find((s) => s.key === "fixes_paid")?.state).toBe("skipped");
  });
});
