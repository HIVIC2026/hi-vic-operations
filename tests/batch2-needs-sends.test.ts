// Batch 2 task 2: Needs me shows sends the office must know about. Run: bun test tests/batch2-needs-sends.test.ts
import { describe, expect, test } from "bun:test";
import { partnerSendFailedRows, sendFailedRows } from "../src/lib/send-failed.core";
import { mittiOfficeItems } from "../src/lib/ready-check-chase.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-10-29T06:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000, D = 86_400_000;
const STOP_LINE = "STOP received, but releasing the installer failed — open the job and cancel again";

describe("not sure it arrived", () => {
  test("text sent_unknown shows a row", () => {
    const [r] = sendFailedRows({ now: NOW, emails: [], sms: [{ job_id: "j", message_type: "spot_saved", status: "sent_unknown", created_at: ago(H), detail: null }] });
    expect(r!.text).toContain("not sure it arrived");
    expect(r!.text).toContain("Spot saved text");
  });
  test("email delivered_unrecorded shows a row", () => {
    const [r] = sendFailedRows({ now: NOW, emails: [{ job_id: "j", purpose: "quote_reminder", status: "delivered_unrecorded", created_at: ago(D), error: "x" }], sms: [] });
    expect(r!.text).toBe("Email not sure it arrived: Quote reminder email, yesterday");
  });
  test("email stuck sending: 2h old shows, 20 min old does not", () => {
    const e = (age: number) => ({ job_id: "j", purpose: "quote_reminder", status: "sending", created_at: ago(age), error: null });
    expect(sendFailedRows({ now: NOW, emails: [e(2 * H)], sms: [] })).toHaveLength(1);
    expect(sendFailedRows({ now: NOW, emails: [e(20 * 60_000)], sms: [] })).toEqual([]);
  });
  test("quiet-hours blocked holds never show", () => {
    expect(sendFailedRows({ now: NOW, emails: [], sms: [{ job_id: "j", message_type: "spot_saved", status: "blocked", created_at: ago(H), detail: "quiet hours" }] })).toEqual([]);
    expect(partnerSendFailedRows({ now: NOW, sms: [{ job_id: null, business_id: "b", message_type: "job_offer", status: "blocked", created_at: ago(H), detail: "quiet hours" }] })).toEqual([]);
  });
  test("a later delivered text / sent email clears it", () => {
    expect(sendFailedRows({ now: NOW, emails: [], sms: [
      { job_id: "j", message_type: "spot_saved", status: "sent_unknown", created_at: ago(2 * H), detail: null },
      { job_id: "j", message_type: "spot_saved", status: "delivered", created_at: ago(H), detail: null }] })).toEqual([]);
    expect(sendFailedRows({ now: NOW, sms: [], emails: [
      { job_id: "j", purpose: "quote_reminder", status: "delivered_unrecorded", created_at: ago(2 * H), error: null },
      { job_id: "j", purpose: "quote_reminder", status: "sent", created_at: ago(H), error: null }] })).toEqual([]);
  });
});

describe("partner texts with no job", () => {
  test("failed job-less text gives one row per business", () => {
    const rows = partnerSendFailedRows({ now: NOW, sms: [
      { job_id: null, business_id: "b1", message_type: "job_offer", status: "failed", created_at: ago(H), detail: "Twilio 30005" },
      { job_id: null, business_id: "b1", message_type: "job_offer", status: "undelivered", created_at: ago(2 * H), detail: null },
      { job_id: null, business_id: null, message_type: "job_offer", status: "failed", created_at: ago(H), detail: null },
    ] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.businessId).toBe("b1");
    expect(rows[0]!.count).toBe(2);
    expect(rows[0]!.text).toContain("Text failed: Job offer text");
  });
  test("a later delivered text to that business clears it; job texts are not partner rows", () => {
    expect(partnerSendFailedRows({ now: NOW, sms: [
      { job_id: null, business_id: "b1", message_type: "job_offer", status: "failed", created_at: ago(2 * H), detail: null },
      { job_id: null, business_id: "b1", message_type: "job_offer", status: "delivered", created_at: ago(H), detail: null }] })).toEqual([]);
    expect(partnerSendFailedRows({ now: NOW, sms: [{ job_id: "j", business_id: "b1", message_type: "job_offer", status: "failed", created_at: ago(H), detail: null }] })).toEqual([]);
  });
  test("Needs me reads business_id and shows the business name in the Partner fold", () => {
    const src = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(src).toContain('select("job_id, business_id, message_type, status, created_at, detail")');
    expect(src).toContain("partnerSendFailedRows(");
    expect(src).toContain('from("businesses").select("id, name")');
  });
});

describe("STOP clean-up failure", () => {
  const raise = { job_id: "j", event_type: "stop_installer_release_failed", created_at: ago(2 * H), details: { needs_office: true }, summary: STOP_LINE };
  test("one row with the office line", () => {
    const items = mittiOfficeItems([raise, { ...raise, created_at: ago(H) }], new Date(NOW));
    expect(items.filter((i) => i.code === "stop_installer_release_failed")).toHaveLength(1);
    expect(NEEDS_TEXT.stop_installer_release_failed.why).toBe(STOP_LINE);
  });
  test("a later job_cancel_released clears it; an earlier one does not", () => {
    const code = (evs: typeof raise[]) => mittiOfficeItems(evs, new Date(NOW)).some((i) => i.code === "stop_installer_release_failed");
    expect(code([raise, { ...raise, event_type: "job_cancel_released", created_at: ago(H), details: {} }])).toBe(false);
    expect(code([{ ...raise, event_type: "job_cancel_released", created_at: ago(3 * H), details: {} }, raise])).toBe(true);
  });
  test("the event is loaded by the needs query", () => {
    const src = readFileSync("src/lib/needs.server.ts", "utf8");
    expect(src).toContain('"stop_installer_release_failed", "job_cancel_released"');
  });
});
