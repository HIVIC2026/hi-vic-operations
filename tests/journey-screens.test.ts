import { describe, expect, test } from "bun:test";
import { reservedPerson, screenMutationBlocker, screenTotals } from "../scripts/journey-screens.core";
const safe = { websiteSandbox: true, serverSendingKeysRemoved: true, serverMittiGuard: true, demoOnly: true, ownQaJob: true };
describe("Jo's full journey screen safety", () => {
  test("only TEST-domain people qualify, not the legacy office identity or real test inbox", () => {
    expect(reservedPerson("qa.worker.alpha@hivic-test.example")).toBe(true);
    expect(reservedPerson("admin@hivic.test")).toBe(false);
    expect(reservedPerson("jolowexo@hotmail.com")).toBe(false);
  });
  test("a command-process guard is not enough for browser mutations", () => {
    expect(screenMutationBlocker({ ...safe, serverMittiGuard: false })).toContain("running portal process");
    expect(screenMutationBlocker({ ...safe, serverSendingKeysRemoved: false })).not.toBeNull();
  });
  test("website sandbox, Demo-only and own qa_test job are mandatory", () => {
    expect(screenMutationBlocker({ ...safe, websiteSandbox: false })).toContain("Base44");
    expect(screenMutationBlocker({ ...safe, demoOnly: false })).toContain("Demo Company");
    expect(screenMutationBlocker({ ...safe, ownQaJob: false })).toContain("fresh qa_test");
    expect(screenMutationBlocker(safe)).toBeNull();
  });
  test("unexecuted rows count as blocked, never pass", () => {
    expect(screenTotals([{ step: "Final payout", person: "electrician", status: "blocked", detail: "Not executed", severity: null, screenshot: null, database: null, emailRows: null }])).toEqual({ pass: 0, fail: 0, blocked: 1 });
  });
});