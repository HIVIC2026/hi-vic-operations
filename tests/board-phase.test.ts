// Jo 9 Oct: the main board must not show anyone in Ready Check without a real Ready Check.
import { describe, expect, test } from "bun:test";
import { boardPhase } from "../src/lib/board-phase.core";

describe("board column follows facts, not the stored stage", () => {
  test("stored ready-to-schedule but classifier says spot saved enquiry -> Enquiries", () => {
    expect(boardPhase("ready_check_ready_to_schedule", "enquiry")).toBe("enquiries");
    expect(boardPhase("ready_check_scheduled", "waiting_list")).toBe("enquiries");
  });
  test("only the classifier's Ready Check puts a job in Ready Check", () => {
    expect(boardPhase("ready_check_scheduled", "ready_check")).toBe("ready_check");
  });
  test("facts not loaded yet: stored Ready Check stages are not shown in Ready Check", () => {
    expect(boardPhase("ready_check_ready_to_schedule", undefined)).toBeNull();
    expect(boardPhase("installation_booked", undefined)).toBe("installation");
  });
  test("measured quote stages show under Quote, not Ready Check", () => {
    expect(boardPhase("measured_estimate_ready", "quote")).toBe("quote_approval");
  });
});
