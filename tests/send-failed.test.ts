// "Send failed" rows for Needs me: failed customer email sends / texts in the last 7 days → one plain row per job.
// Pure: nothing read, nothing resent. Run: bun test tests/send-failed.test.ts
import { describe, expect, test } from "bun:test";
import { SEND_FAILED_WINDOW_DAYS, daysAgoLabel, plainSendError, sendFailedRows, sendLabel } from "../src/lib/send-failed.core";

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
        { job_id: "fresh", purpose: "quote_reminder", status: "sending", created_at: new Date(NOW - 60_000).toISOString(), error: null },
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
      "Text not delivered: Spot saved text, yesterday — phone off or out of range · Email failed: Save my spot email, 2 days ago — Resend 422: invalid `to` address · Text failed: Save my spot reminder text, 3 days ago — Twilio 400: bad number",
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

describe("provider errors in plain words (design review 26 Oct)", () => {
  test("known Twilio codes become a phrase, from the JSON body or the code after Twilio", () => {
    expect(plainSendError(`Twilio 400: {"code":21614,"message":"'To' number: +6144484XXXX, is not a valid mobile number","more_info":"https://www.twilio.com/docs/errors/21614"}`)).toBe("not a mobile number");
    expect(plainSendError("Twilio error 30003")).toBe("phone off or out of range");
    expect(plainSendError("Twilio 30007: filtered")).toBe("blocked by the phone company as spam");
  });
  test("other JSON errors keep only their message; plain text passes through; nothing never prints", () => {
    expect(plainSendError(`Resend 422: {"name":"validation_error","message":"Invalid \`to\` field."}`)).toBe("Invalid `to` field.");
    expect(plainSendError(`Twilio 400: {"code":99999}`)).toBe("Twilio 400");
    expect(plainSendError("Resend 422: invalid `to` address")).toBe("Resend 422: invalid `to` address");
    expect(plainSendError(null)).toBe("");
  });
  test("a Needs me row never shows raw JSON", () => {
    const now = Date.parse("2026-10-26T00:00:00Z");
    const [row] = sendFailedRows({ now, emails: [], sms: [{ job_id: "j", message_type: "spot_saved", status: "failed", created_at: new Date(now - 3 * 86_400_000).toISOString(), detail: `Twilio 400: {"code":21614,"message":"x"}` }] });
    expect(row!.text).toBe("Text failed: Spot saved text, 3 days ago — not a mobile number");
    expect(row!.text).not.toContain("{");
  });
});

describe("fixed failures are hidden", () => {
  const fail = (job: string, purpose: string, at: string) => ({ job_id: job, purpose, status: "failed", created_at: at, error: "No approved Jo template applies" });
  const sent = (job: string, purpose: string, at: string) => ({ job_id: job, purpose, status: "sent", created_at: at, error: null });
  const smsRow = (status: string, at: string) => ({ job_id: "j", message_type: "spot_saved", status, created_at: at, detail: "x" });
  test("a failed email later sent OK is hidden (Watkinson case)", () => {
    expect(sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("j", "existing_leads_launch_v1", ago(4.9))], sms: [] })).toEqual([]);
  });
  test("a sent email of a different kind does not hide it", () => {
    expect(sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("j", "quote_reminder", ago(4))], sms: [] })).toHaveLength(1);
  });
  test("a success before or at the same time as the failure does not hide it", () => {
    expect(sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("j", "existing_leads_launch_v1", ago(6))], sms: [] })).toHaveLength(1);
    expect(sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("j", "existing_leads_launch_v1", ago(5))], sms: [] })).toHaveLength(1);
  });
  test("a success on another job does not hide it", () => {
    expect(sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("k", "existing_leads_launch_v1", ago(4))], sms: [] })).toHaveLength(1);
  });
  test("a failed text later delivered is hidden; a later 'sent' text is not enough", () => {
    expect(sendFailedRows({ now: NOW, emails: [], sms: [smsRow("failed", ago(5)), smsRow("delivered", ago(4))] })).toEqual([]);
    expect(sendFailedRows({ now: NOW, emails: [], sms: [smsRow("undelivered", ago(5)), smsRow("sent", ago(4))] })).toHaveLength(1);
  });
  test("only the unfixed failure stays on a job's row", () => {
    const rows = sendFailedRows({ now: NOW, emails: [fail("j", "existing_leads_launch_v1", ago(5)), sent("j", "existing_leads_launch_v1", ago(4)), fail("j", "quote_reminder", ago(3))], sms: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(1);
    expect(rows[0]!.text).toContain("Quote reminder email");
    expect(rows[0]!.text).not.toContain("Save my spot");
  });
});

describe("send failed reads are paged safely", () => {
  test("failed + successful email and text reads have a fixed order, so no page skips a row", async () => {
    const src = await Bun.file(new URL("../src/lib/office-needs.server.ts", import.meta.url)).text();
    expect(src).toMatch(/\.in\("status", \[\.\.\.FAILED_EMAIL_STATUSES, \.\.\.UNSURE_EMAIL_STATUSES, \.\.\.SUCCESS_EMAIL_STATUSES\]\)\.gte\("created_at", since7\)\.order\("created_at"\)\.order\("id"\)\.range/);
    expect(src).toMatch(/\.in\("status", \[\.\.\.FAILED_SMS_STATUSES, \.\.\.UNSURE_SMS_STATUSES, \.\.\.SUCCESS_SMS_STATUSES\]\)\.gte\("created_at", since7\)\.order\("created_at"\)\.order\("id"\)\.range/);
  });
});

describe("A48 batch 2 texts never land in Needs me (Jo, final review m9)", () => {
  const TYPES = ["quick_taps", "quick_taps_reminder", "run_offered", "run_time", "run_time_reminder", "run_slot_cancelled"];
  test("failed / not-sure batch and run texts make no job row and no partner row; other texts still do", async () => {
    const { partnerSendFailedRows } = await import("../src/lib/send-failed.core");
    const sms = [
      ...TYPES.flatMap((t) => [
        { job_id: "j1", message_type: t, status: "failed", created_at: ago(1), detail: "Twilio 400" },
        { job_id: "j1", message_type: t, status: "sent_unknown", created_at: ago(1), detail: null },
        { job_id: null, business_id: "biz-1", message_type: t, status: "undelivered", created_at: ago(1), detail: null },
      ]),
      { job_id: "j2", message_type: "spot_saved", status: "failed", created_at: ago(1), detail: "Twilio 400" },
      { job_id: null, business_id: "biz-2", message_type: "job_offer", status: "failed", created_at: ago(1), detail: null },
    ];
    expect(sendFailedRows({ now: NOW, emails: [], sms }).map((r) => r.jobId)).toEqual(["j2"]);
    expect(partnerSendFailedRows({ now: NOW, sms }).map((r) => r.businessId)).toEqual(["biz-2"]);
  });
});
