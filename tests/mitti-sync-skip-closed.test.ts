// HV-1351: cancelled / soft-deleted / QA-archived jobs are never synced and never get a quote drafted or held.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isClosedOrArchivedJob } from "../src/lib/mitti.core";

describe("closed or archived jobs are skipped by the Mitti sync", () => {
  test("HV-1351 shape (cancelled + QA-archived) is skipped", () => {
    expect(isClosedOrArchivedJob({ stage: "cancelled", deleted_at: null, qa_archived_at: "2026-10-21T03:20:00Z" })).toBe(true);
  });
  test("each condition alone is skipped", () => {
    expect(isClosedOrArchivedJob({ stage: "cancelled" })).toBe(true);
    expect(isClosedOrArchivedJob({ stage: "ready_check_scheduled", deleted_at: "2026-10-20T00:00:00Z" })).toBe(true);
    expect(isClosedOrArchivedJob({ stage: "ready_check_scheduled", qa_archived_at: "2026-10-21T03:20:00Z" })).toBe(true);
  });
  test("a live job is still processed", () => {
    expect(isClosedOrArchivedJob({ stage: "ready_check_scheduled", deleted_at: null, qa_archived_at: null })).toBe(false);
    expect(isClosedOrArchivedJob({ stage: "on_hold", deleted_at: null, qa_archived_at: null })).toBe(false); // other guards unchanged
  });
  test("the sync and the quote draft check it before any event or quote write", () => {
    const sync = readFileSync("src/lib/mitti.server.ts", "utf8");
    const body = sync.slice(sync.indexOf("export async function syncMittiAssessment"));
    expect(body.indexOf("isClosedOrArchivedJob(job)")).toBeGreaterThan(0);
    expect(body.indexOf("isClosedOrArchivedJob(job)")).toBeLessThan(body.indexOf("logEvent("));
    const q = readFileSync("src/lib/installer-quote.server.ts", "utf8");
    const qb = q.slice(q.indexOf("export async function draftInstallerQuoteFromReadyCheck"));
    expect(qb.indexOf("isClosedOrArchivedJob(job)")).toBeGreaterThan(0);
    expect(qb.indexOf("isClosedOrArchivedJob(job)")).toBeLessThan(qb.indexOf("installer_quote_held") === -1 ? Infinity : qb.indexOf("installer_quote_held"));
    expect(qb.indexOf("isClosedOrArchivedJob(job)")).toBeLessThan(qb.indexOf('from("quotes").insert') === -1 ? Infinity : qb.indexOf('from("quotes").insert'));
  });
});
