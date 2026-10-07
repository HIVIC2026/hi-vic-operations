import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkPiesaWindow, installDeadline } from "../src/lib/readycheck.core";

describe("PIESA booking does not need a paired install slot (Jo 7 Oct)", () => {
  test("no planned install date is fine", () => {
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: null, piesa_completed_at: null, today: "2026-10-08" }).readyForPiesa).toBe(true);
  });
  test("booking guard has no install-slot blocker", () => {
    const src = readFileSync("src/lib/workflow.server.ts", "utf8");
    expect(src).not.toContain("Reserve a realistic installation slot");
  });
  test("install-window rule still applies at install booking", () => {
    expect(installDeadline("2026-10-01T00:00:00Z")).toBe("2026-10-31");
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: "2026-11-05", piesa_completed_at: "2026-10-01", today: "2026-10-08" }).hardWarning).toContain("after the PIESA window");
    expect(readFileSync("src/lib/booking.server.ts", "utf8")).toContain("installDayOutsideWindow");
  });
});
