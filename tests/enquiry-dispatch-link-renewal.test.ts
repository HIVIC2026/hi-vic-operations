// Regression: expired Step-3 links must not permanently block the enquiry backlog.
//
// Root cause fixed here: `sendableFrom` used to require an ALREADY-ACTIVE customer_estimate_links row,
// but only `syncStep3` (Gate 1 / intake) ever creates one and the link TTL is 30 days. Old backlog
// links expire, so "Ready to send" was permanently 0 and every send skipped "No secure estimate link yet."
// The dispatch action must (re)issue the link immediately before sending; the readiness check must not
// require one that already exists.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { planLink } from "../src/lib/estimatelink.core";

const dispatchServer = readFileSync("src/lib/enquiry-dispatch.server.ts", "utf8");
const dispatchFns = readFileSync("src/lib/enquiry-dispatch.functions.ts", "utf8");
const hotSend = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");

const NOW = Date.parse("2026-10-19T00:00:00Z");

describe("link renewal rule", () => {
  const expiredActive = { id: "1", status: "active", expires_at: new Date(NOW - 1).toISOString() };
  const liveActive = { id: "2", status: "active", expires_at: new Date(NOW + 5 * 86_400_000).toISOString() };

  // Jo 1 Nov 2026: links have no time limit — an old active link is reused (same token, owner's emails keep working).
  it("reuses an old still-'active' link instead of re-issuing it", () => {
    expect(planLink(expiredActive, true, NOW)).toEqual({ action: "reuse" });
  });

  it("reuses a live link (no duplicate link spam)", () => {
    expect(planLink(liveActive, true, NOW).action).toBe("reuse");
  });

  it("issues when the backlog has no link at all", () => {
    expect(planLink(null, true, NOW).action).toBe("issue");
  });
});

describe("dispatch wiring", () => {
  it("sendableFrom no longer requires a pre-existing active link", () => {
    const fn = dispatchServer.slice(
      dispatchServer.indexOf("export async function sendableFrom"),
      dispatchServer.indexOf("export async function ensureEstimateLinks"),
    );
    // It must still require a current estimate…
    expect(fn).toContain("from(\"indicative_estimates\")");
    expect(fn).toContain("hasEstimate.has(id)");
    // …but must NOT query/lock on customer_estimate_links any more.
    expect(fn).not.toContain("customer_estimate_links");
  });

  it("exposes ensureEstimateLinks, which calls syncStep3 and never sends", () => {
    expect(dispatchServer).toContain("export async function ensureEstimateLinks");
    const fn = dispatchServer.slice(dispatchServer.indexOf("export async function ensureEstimateLinks"));
    expect(fn).toContain("syncStep3");
    expect(fn).toMatch(/linkUsable/);
    // No email/provider call may live in link preparation.
    expect(fn).not.toMatch(/deliver\(|sendSaveMySpot|sendOne\(/);
  });

  it("a batch dispatch prepares links BEFORE sending", () => {
    const iEnsure = dispatchFns.indexOf("await ensureEstimateLinks(ids");
    const iSend = dispatchFns.indexOf("sendSaveMySpot(ids");
    expect(iEnsure).toBeGreaterThan(-1);
    expect(iSend).toBeGreaterThan(-1);
    expect(iEnsure).toBeLessThan(iSend);
  });

  it("a failed-send retry also renews the link before sending", () => {
    const retry = dispatchFns.slice(dispatchFns.indexOf("retryFailedEnquirySend"));
    const iEnsure = retry.indexOf("ensureEstimateLinks([data.jobId]");
    const iSend = retry.indexOf("sendSaveMySpot([data.jobId]");
    expect(iEnsure).toBeGreaterThan(-1);
    expect(iSend).toBeGreaterThan(-1);
    expect(iEnsure).toBeLessThan(iSend);
  });

  it("the sender still fails closed when no link exists (safety net stays)", () => {
    expect(hotSend).toContain("No secure estimate link yet.");
  });
});
