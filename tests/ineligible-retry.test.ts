import { describe, expect, it } from "bun:test";
import { retryFailedIneligible } from "../src/lib/ineligible-retry.core";
const jobId = "a421ed6d-7c62-4b08-95c6-c2784dc0e1e4";
const failed = { job_id: jobId, purpose: "preliminary_ineligible", status: "failed", idempotency_key: `preliminary_ineligible:${jobId}` };
describe("isolated ineligible retry; no database/provider", () => {
  for (const [name, row] of [
    ["missing", null], ["another job", { ...failed, job_id: "other" }],
    ["launch campaign", { ...failed, purpose: "existing_leads_launch_v1" }],
    ["sent", { ...failed, status: "sent" }], ["sending", { ...failed, status: "sending" }],
    ["uncertain", { ...failed, status: "delivered_unrecorded" }],
    ["wrong key", { ...failed, idempotency_key: "other" }],
  ] as const) it(`blocks ${name} before sending`, async () => {
    let calls = 0;
    const result = await retryFailedIneligible(jobId, { read: async () => row, send: async () => { calls++; return { sent: true }; } });
    expect(result.outcome).toBe("blocked"); expect(calls).toBe(0);
  });
  it("delegates only the specified job once", async () => {
    const calls: string[] = [];
    const result = await retryFailedIneligible(jobId, { read: async () => failed, send: async id => { calls.push(id); return { sent: true }; } });
    expect(calls).toEqual([jobId]); expect(result.outcome).toBe("sent");
  });
  for (const reason of ["no_consent", "unsubscribed", "official_not_ineligible", "already_sent", "comms_disabled"])
    it(`preserves ${reason}`, async () => {
      expect(await retryFailedIneligible(jobId, { read: async () => failed, send: async () => ({ sent: false, reason }) })).toEqual({ outcome: "blocked", detail: reason });
    });
});
