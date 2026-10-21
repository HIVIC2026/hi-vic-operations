import { expect, mock, test } from "bun:test";

const token = "a".repeat(64);
const rows: Record<string, unknown> = {
  customer_estimate_links: { id: "link", job_id: "job", status: "active", expires_at: "2099-01-01T00:00:00Z", current_estimate_id: "estimate" },
  indicative_estimates: { id: "estimate", job_id: "job", status: "current", input_signature: "sig", settings_version: 1 },
  ready_check_acceptances: { id: "acceptance", estimate_id: "estimate", accepted_at: "2026-10-19T03:11:00Z", estimate_input_signature: "sig", estimate_settings_version: 1, ready_check_amount_inc_gst: 99, cost_after_discount_inc_gst: 4148, estimated_remaining_balance_inc_gst: 4049 },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    const result = () => ({ data: table === "ready_check_windows" ? [1, 2, 3].map(day => ({ round: 1, status: "open", starts_at: `2026-10-${21 + day}T00:00:00Z`, ends_at: `2026-10-${21 + day}T02:00:00Z` })) : rows[table], error: null });
    const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle: async () => result(), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  },
} }));

const { readyCheckAcceptanceState, simulateReadyCheckPayment } = await import("../src/lib/readycheck-payment.server");

test("Jo 19 Oct: existing Ready Check acceptance shows $0 and the full remaining project balance", async () => {
  const state = await readyCheckAcceptanceState(token);
  expect(state?.amountIncGst).toBe(0);
  expect(state?.estimatedRemainingBalanceIncGst).toBe(4148);
  expect(state?.paymentId).toBeNull();
  expect(state?.paidAt).toBeNull();
});

test("Jo 19 Oct: even a legacy payment caller cannot charge for a Ready Check", async () => {
  await expect(simulateReadyCheckPayment(token, "success", "test-only-key")).rejects.toThrow("The Ready Check is free. No payment is required.");
});