import { expect, mock, test } from "bun:test";
let calls: unknown[][] = [];
let status = "complete";
mock.module("../src/lib/intelligence.server", () => ({ runPropertyIntelligence: async (...args: unknown[]) => { calls.push(args); return { status }; } }));
const { processFirmQuoteSizeCheck } = await import("../src/lib/firm-quote-work.server");
test("dedicated queued work calls only the requested size check with system attribution", async () => {
  calls = []; status = "complete";
  await processFirmQuoteSizeCheck("job");
  expect(calls).toEqual([["job", null, "firm quote requested"]]);
});
test("failed size check is not marked successfully complete", async () => {
  status = "error";
  await expect(processFirmQuoteSizeCheck("job")).rejects.toThrow("could not be completed");
});