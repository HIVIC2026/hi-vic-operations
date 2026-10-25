// Decision 335 (Jo, 25 Oct 2026): the My job review screen. Pure rules + source pins: stars recorded as an event, 4–5 →
// Google (when set), 1–3 → private feedback + one Needs me row, never Google. Run: bun test tests/owner-review.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWNER_REVIEW_FEEDBACK_EVENT, OWNER_REVIEW_STARS_EVENT, REVIEW_COPY, REVIEW_FEEDBACK_ROW_DAYS, googleReviewLink, parseStars, reviewFeedbackBlocker, reviewFeedbackRows, reviewOutcome, reviewScreen, shouldRecordStars,
} from "../src/lib/owner-review.core";

const src = (p: string) => readFileSync(p, "utf8");
const G = "https://g.page/r/hiv/review";

describe("stars", () => {
  test("?stars=N parses 1..5 only", () => {
    expect(parseStars("4")).toBe(4);
    expect(parseStars(5)).toBe(5);
    for (const bad of ["0", "6", "4.5", "x", "", null, undefined, 3.2]) expect(parseStars(bad)).toBeNull();
  });
  test("4–5 → Google; 1–3 → private; never Google for 1–3", () => {
    expect([1, 2, 3, 4, 5].map(reviewOutcome)).toEqual(["private", "private", "private", "google", "google"]);
    expect(reviewScreen(5, G)).toEqual({ kind: "thanks", googleUrl: G });
    expect(reviewScreen(4, null)).toEqual({ kind: "thanks", googleUrl: null }); // link unset → thanks only
    for (const n of [1, 2, 3]) expect(reviewScreen(n, G)).toEqual({ kind: "feedback" });
    expect(reviewScreen(null, G)).toEqual({ kind: "ask" });
  });
  test("Google link only from a real https env value", () => {
    expect(googleReviewLink(` ${G} `)).toBe(G);
    for (const bad of [null, undefined, "", "http://x", "g.page/r/x"]) expect(googleReviewLink(bad)).toBeNull();
  });
  test("the same stars again within 24h (page reload) is not recorded twice; a change is", () => {
    const at = "2026-11-18T00:00:00Z";
    expect(shouldRecordStars(5, null)).toBe(true);
    expect(shouldRecordStars(5, { stars: 5, at }, new Date("2026-11-18T05:00:00Z"))).toBe(false);
    expect(shouldRecordStars(4, { stars: 5, at }, new Date("2026-11-18T05:00:00Z"))).toBe(true);
    expect(shouldRecordStars(5, { stars: 5, at }, new Date("2026-11-19T01:00:00Z"))).toBe(true);
  });
});

describe("private feedback", () => {
  test("only for 1–3 stars, not empty, bounded", () => {
    expect(reviewFeedbackBlocker(2, "The installer was late")).toBeNull();
    expect(reviewFeedbackBlocker(4, "x")).toMatch(/1 to 3 stars/);
    expect(reviewFeedbackBlocker(null, "x")).toMatch(/1 to 3 stars/);
    expect(reviewFeedbackBlocker(1, "   ")).toMatch(/tell us/);
    expect(reviewFeedbackBlocker(3, "a".repeat(1001))).toMatch(/1000/);
    expect(REVIEW_COPY.feedbackTitle).toBe("What could we have done better?");
  });
  test("ONE Needs me row per job (latest), for 14 days, TEST hidden unless asked", () => {
    const now = Date.parse("2026-11-20T00:00:00Z");
    const jobs = new Map([["j1", { jobNumber: "HV-1", surname: "Yang" }], ["j2", { jobNumber: "HV-2", surname: "Lee", isTest: true }]]);
    const rows = reviewFeedbackRows([
      { job_id: "j1", created_at: "2026-11-18T00:00:00Z", details: { stars: 2, feedback: "Late" } },
      { job_id: "j1", created_at: "2026-11-19T00:00:00Z", details: { stars: 1, feedback: "Mess left behind" } },
      { job_id: "j2", created_at: "2026-11-19T00:00:00Z", details: { stars: 3, feedback: "ok" } },
      { job_id: "j1", created_at: new Date(now - REVIEW_FEEDBACK_ROW_DAYS * 86_400_000).toISOString(), details: { stars: 1, feedback: "old" } },
    ], jobs, now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "review-feedback:j1", tag: "Review", who: "HV-1 Yang", line: "1 star · “Mess left behind”", href: "/admin/jobs/j1", jobId: "j1" });
    expect(reviewFeedbackRows([{ job_id: "j2", created_at: "2026-11-19T00:00:00Z", details: { stars: 3, feedback: "ok" } }], jobs, now, true)).toHaveLength(1);
  });
});

describe("source pins", () => {
  const server = src("src/lib/owner-review.server.ts");
  test("append-only events, no senders, no stage change", () => {
    expect(OWNER_REVIEW_STARS_EVENT).toBe("owner_review_stars");
    expect(OWNER_REVIEW_FEEDBACK_EVENT).toBe("owner_review_feedback");
    expect(server).toContain("OWNER_REVIEW_STARS_EVENT");
    expect(server).toContain("needs_office: true");
    expect(server).not.toMatch(/\.update\(|\.delete\(|transition\(|sendRealSms|sendGuardedOwnerEmail|fetch\(/);
  });
  test("My job: review screen reads ?stars=, records the tap, Google only on the thanks view", () => {
    const page = src("src/routes/my-job.$token.tsx");
    expect(page).toContain("function ReviewScreen(");
    expect(page).toContain("data-review-feedback");
    expect(page).toContain('rel="noopener noreferrer"');
    expect(src("src/lib/owner-myjob.core.ts")).toContain('"review"');
    expect(src("src/lib/owner-link.functions.ts")).toContain("recordOwnerReviewStars(jobId, data.stars");
  });
  test("Needs me reads the feedback rows", () => {
    expect(src("src/lib/office-needs.server.ts")).toContain("reviewFeedbackRows(");
  });
});
