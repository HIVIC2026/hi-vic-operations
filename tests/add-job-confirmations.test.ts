import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { feeAwarenessBlocker, HIVIC_READY_CHECK_PRICING_TICK, OWNER_FEE_AWARENESS_TICK } from "../src/lib/owner-confirm.core";

const read = (path: string) => readFileSync(path, "utf8");

describe("Add job confirmations and source-specific pricing", () => {
  test("fee awareness is mandatory and uses the approved plain wording", () => {
    expect(feeAwarenessBlocker(false)).toContain("fees");
    expect(feeAwarenessBlocker(true)).toBeNull();
    expect(OWNER_FEE_AWARENESS_TICK).toContain("$349 PIESA fee");
  });

  test("Home Insulation Victoria customer pricing acknowledgement is exact and source-specific", () => {
    expect(HIVIC_READY_CHECK_PRICING_TICK).toBe("I confirm I will not discuss pricing with the home owner during my Ready Check. All pricing discussions are to come directly from Home Insulation Victoria.");
    const ui = read("src/components/trade/TradePrestart.tsx");
    expect(ui).toContain('channel === "hivic_sourced"');
    expect(ui).toContain("HIVIC_READY_CHECK_PRICING_TICK");
  });

  test("single Add job records consent, fee awareness, R2 and attaches uploaded files", () => {
    const server = read("src/lib/partner-import.server.ts");
    for (const fact of ["contact_permission", "fee_awareness", "existing_below_r2", 'from("documents").insert']) expect(server).toContain(fact);
    // Decision 34 (Jo 24 Oct): Add a job itself is basics only — no file upload, fee or R2 ticks on that screen.
    const page = read("src/components/trade/add-job-flow.tsx");
    expect(page).toContain("OWNER_CONTACT_PERMISSION");
    expect(page).not.toContain("Upload one customer file");
    expect(page).not.toContain('to="/partner/bulk-import"');
  });

  test("owner acceptance queues an idempotent installer update", () => {
    const acceptance = read("src/lib/portal.functions.ts");
    expect(acceptance).toContain('owner-quote-accepted-v1');
    expect(acceptance).toContain('quote_accepted:${q.id}');
  });
});