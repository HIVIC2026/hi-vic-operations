import { describe, expect, test } from "bun:test";
import { STAGE_BOARD, columnFor, filterBoard, groupBoard, type BoardJob } from "../src/lib/jobs-board.core";
import { STAGE_ORDER, EXCEPTION_STAGES } from "../src/lib/workflow";
import { retiredOfficeRedirect, sectionFor } from "../src/lib/office-nav";

const j = (o: Partial<BoardJob>): BoardJob => ({ id: Math.random().toString(), job_number: "HV-1", stage: "new_enquiry", eligibility_outcome: null, channel: "hivic_sourced", source: "base44", owner_name: null, property_address: null, last_activity_at: null, ...o });

describe("jobs board", () => {
  test("every stage in the code has a plain name and column", () => {
    for (const s of [...STAGE_ORDER, ...EXCEPTION_STAGES]) expect(STAGE_BOARD[s]?.plain.length).toBeGreaterThan(0);
  });
  test("Jo's mapping", () => {
    expect(columnFor("ready_check_ready_to_schedule")).toBe("spot");
    expect(columnFor("awaiting_deposit_payment")).toBe("quote");
    expect(columnFor("installation_booked")).toBe("booked");
    expect(columnFor("ready_for_veec")).toBe("installed");
    expect(columnFor("complete")).toBe("claimed");
    expect(columnFor("cancelled")).toBe("not_active");
    expect(columnFor("on_hold")).toBe("not_active");
  });
  test("eligibility is a filter; TEST hidden by default; cancelled not in active columns", () => {
    const jobs = [j({ eligibility_outcome: "likely_eligible" }), j({ eligibility_outcome: "likely_eligible", source: "qa_test" }), j({ eligibility_outcome: "likely_eligible", stage: "cancelled" }), j({ eligibility_outcome: "does_not_appear_eligible" })];
    const f = filterBoard(jobs, { elig: "likely" });
    expect(f.length).toBe(2);
    const g = groupBoard(f);
    expect(g.spot.length).toBe(1);
    expect(g.not_active.length).toBe(1);
    expect(filterBoard(jobs, { elig: "likely", test: true }).length).toBe(3);
  });
  test("source filter", () => {
    const jobs = [j({ channel: "installer_sourced" }), j({})];
    expect(filterBoard(jobs, { src: "upload" }).length).toBe(1);
    expect(filterBoard(jobs, { src: "hiv" }).length).toBe(1);
  });
  test("old links redirect", () => {
    expect(retiredOfficeRedirect("/admin/pipeline", {})?.to).toBe("/admin/jobs");
    expect(retiredOfficeRedirect("/admin", { tab: "enquiries" })?.search).toEqual({ elig: "likely" });
    expect(retiredOfficeRedirect("/admin", { tab: "quotes" })).toBeNull();
    expect(sectionFor("/admin/jobs")).toBe("jobs");
  });
});
