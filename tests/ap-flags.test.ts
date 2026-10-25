import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { apFlags, approvalNoteBlocker, areaVariancePct, type ApFlagFacts } from "../src/lib/ap-flags.core";

const clean: ApFlagFacts = { estimatedAreaM2: 100, measuredAreaM2: 110, recordedVariancePct: null, measurementAcceptedReason: null, evidenceRejections: 0, paymentOverrides: 0, quoteManualEdits: 0, visitIssues: [] };

describe("AP flags", () => {
  test("clean job has no flags", () => expect(apFlags(clean)).toEqual([]));
  test("area exactly 15% is not flagged; over 15% is", () => {
    expect(apFlags({ ...clean, measuredAreaM2: 115 })).toEqual([]);
    expect(apFlags({ ...clean, measuredAreaM2: 120 })[0]).toContain("20% from the estimate");
    expect(apFlags({ ...clean, measuredAreaM2: 80 })[0]).toContain("20%");
  });
  test("recorded variance wins; no estimate = no area flag", () => {
    expect(areaVariancePct({ estimatedAreaM2: 100, measuredAreaM2: 100, recordedVariancePct: -30 })).toBe(30);
    expect(areaVariancePct({ estimatedAreaM2: null, measuredAreaM2: 100, recordedVariancePct: null })).toBeNull();
  });
  test("each existing-record reason is listed", () => {
    const f = apFlags({ ...clean, measurementAcceptedReason: "checked onsite", evidenceRejections: 2, paymentOverrides: 1, quoteManualEdits: 1, visitIssues: ["trade_no_show", "owner_late_change", "trade_no_show"] });
    expect(f).toHaveLength(6);
    expect(f.join(" ")).toContain("rejected 2 times");
  });
  test("flagged jobs need a note; clean jobs don't", () => {
    expect(approvalNoteBlocker(["x"], "  ")).not.toBeNull();
    expect(approvalNoteBlocker(["x"], "ok")).toBeNull();
    expect(approvalNoteBlocker([], undefined)).toBeNull();
  });
});

describe("wiring (static)", () => {
  const fn = readFileSync(new URL("../src/lib/ap-queue.functions.ts", import.meta.url), "utf8");
  test("approval takes exactly one job — no bulk", () => {
    expect(fn).toContain("jobId: z.string().uuid()");
    expect(fn).not.toMatch(/jobIds|z\.array/);
  });
  test("approval checks the stage and writes its own record", () => {
    expect(fn).toContain('!== "ap_review"');
    expect(fn).toContain('"ap_approved"');
  });
  test("nothing on the timer approves AP review", () => {
    const tick = readFileSync(new URL("../src/routes/api/public/hooks/allocation-tick.ts", import.meta.url), "utf8");
    expect(tick).not.toMatch(/ap-queue|approveAp/);
  });
});

describe("AP approval only through the queue (static)", () => {
  const pf = readFileSync(new URL("../src/lib/portal.functions.ts", import.meta.url), "utf8");
  test("no compliance or evidence action can promote AP review", () => {
    expect(pf).not.toContain("allowApPromotion");
    expect(readFileSync(new URL("../src/lib/autoadvance.core.ts", import.meta.url), "utf8")).toContain('stop("Final check: approve in AP queue")');
  });
  test("old Ready for VEEC action refuses AP review jobs", () => expect(pf).toContain("Final AP approval happens only in the AP approval queue"));
  test("Final check card approves one job through approveApJob (no bulk, no AP queue detour)", () => {
    // Decision 372: the Approve moved from the compliance card to the one-screen Final check (same human action).
    const parts = readFileSync(new URL("../src/components/portal/final-check.tsx", import.meta.url), "utf8");
    expect(parts).toContain("useAction(approveApJob)");
    expect(parts).toContain("approve({ jobId,");
    expect(readFileSync(new URL("../src/components/portal/office-job-parts.tsx", import.meta.url), "utf8")).not.toContain("approveApJob");
  });
});
