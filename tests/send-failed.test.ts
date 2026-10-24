// "Send failed" rows for Needs me: failed customer email sends / texts in the last 7 days → one plain row per job.
// Pure: nothing read, nothing resent. Run: bun test tests/send-failed.test.ts
import { describe, expect, test } from "bun:test";
import { SEND_FAILED_WINDOW_DAYS, daysAgoLabel, sendFailedRows, sendLabel } from "../src/lib/send-failed.core";

const NOW = Date.parse("2026-10-24T06:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("send failed classifier", () => {
  test("window is 7 days; older failures and non-failure statuses are ignored", () => {
    expect(SEND_FAILED_WINDOW_DAYS).toBe(7);
    const rows = sendFailedRows({
      now: NOW,
      emails: [
        { job_id: "old", purpose: "existing_leads_launch_v1", status: "failed", created_at: ago(8), error: "x" },
        { job_id: "sent", purpose: "existing_leads_launch_v1", status: "sent", created_at: ago(1), error: null },
        { job_id: "unknown", purpose: "existing_leads_launch_v1", status: "delivered_unrecorded", created_at: ago(1), error: "Delivery result unknown" },
        { job_id: "sending", purpose: "quote_reminder", status: "sending", created_at: ago(1), error: null },
      ],
      sms: [
        { job_id: null, message_type: "job_offer", status: "failed", created_at: ago(1), detail: "no job" },
        { job_id: "blocked", message_type: "spot_saved", status: "blocked", created_at: ago(1), detail: "switch off" },
      ],
    });
    expect(rows).toEqual([]);
  });
  test("one row per job, newest failure first, plain labels and the provider reason", () => {
    const rows = sendFailedRows({
      now: NOW,
      emails: [
        { job_id: "j1", purpose: "existing_leads_launch_v1", status: "failed", created_at: ago(2), error: "Resend 422: invalid `to` address" },
        { job_id: "j2", purpose: "estimate_followup_day_7", status: "failed", created_at: ago(0.2), error: null },
      ],
      sms: [
        { job_id: "j1", message_type: "spot_saved", status: "undelivered", created_at: ago(1), detail: "Twilio 30003: unreachable handset" },
        { job_id: "j1", message_type: "save_spot_reminder", status: "failed", created_at: ago(3), detail: "Twilio 400: bad number" },
      ],
    });
    expect(rows.map((r) => r.jobId)).toEqual(["j2", "j1"]);
    expect(rows[0]).toEqual({ jobId: "j2", count: 1, latestAt: ago(0.2), text: "Email failed: Estimate reminder (day 7), today" });
    expect(rows[1]!.count).toBe(3);
    expect(rows[1]!.latestAt).toBe(ago(1));
    expect(rows[1]!.text).toBe(
      "Text not delivered: Spot saved text, yesterday — Twilio 30003: unreachable handset · Email failed: Save my spot email, 2 days ago — Resend 422: invalid `to` address · Text failed: Save my spot reminder text, 3 days ago — Twilio 400: bad number",
    );
  });
  test("more than three failures on one job are summarised; long reasons are trimmed", () => {
    const emails = [0, 1, 2, 3, 4].map((d) => ({ job_id: "j", purpose: "custom_purpose", status: "failed", created_at: ago(d), error: "e".repeat(200) }));
    const [row] = sendFailedRows({ now: NOW, emails, sms: [] });
    expect(row!.count).toBe(5);
    expect(row!.text.endsWith(" · and 2 more")).toBe(true);
    expect(row!.text).toContain("custom purpose");
    expect(row!.text).toContain("…");
    expect(row!.text.split(" · ").length).toBe(4);
  });
  test("labels and relative days", () => {
    expect(sendLabel("three_questions_reminder", "sms")).toBe("3 questions reminder text");
    expect(sendLabel("three_questions_reminder", "email")).toBe("3 questions reminder email");
    expect(sendLabel("unknown_thing", "email")).toBe("unknown thing");
    expect(daysAgoLabel(ago(0), NOW)).toBe("today");
    expect(daysAgoLabel(ago(1), NOW)).toBe("yesterday");
    expect(daysAgoLabel(ago(4.5), NOW)).toBe("4 days ago");
  });
});
