// Jo 8 Oct: "WE DONT HAVE ANY JOBS AT READY CHECK". The stored stage alone must never put a job in Ready Check.
import { describe, expect, test } from "bun:test";
import { officeStatus, type JobFacts } from "../src/lib/office-status.core";

const NOW = Date.parse("2026-10-09T00:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const job = (stage: string, x: Partial<JobFacts> = {}): JobFacts => ({ id: "j", stage, createdAt: ago(5), lastActivityAt: ago(1), enteredStageAt: ago(1), ...x });
const spot = { spotSavedAt: ago(2), optedOutAt: null, videoRequested: false, mediaReceivedAt: null, deskCheckStatus: null, createdAt: ago(3) };
const stage = (f: JobFacts) => officeStatus(f, NOW)?.stage;

describe("pipeline uses facts, not the stored stage", () => {
  test("spot saved only, legacy ready-to-schedule stage -> Enquiry, not Ready Check", () => {
    expect(officeStatus(job("ready_check_ready_to_schedule", { campaign: spot }), NOW)?.key).toBe("enquiry.spot_saved");
  });
  test("estimate link only, no send, no spot -> waiting list", () => {
    expect(stage(job("ready_check_ready_to_schedule", { estimateSentAt: ago(1) }))).toBe("waiting_list");
  });
  test("scheduled stage with no real Ready Check booking is not Booked", () => {
    expect(officeStatus(job("ready_check_scheduled", { campaign: spot }), NOW)?.key).toBe("enquiry.spot_saved");
    expect(stage(job("ready_check_scheduled"))).not.toBe("ready_check");
  });
  test("onsite booking with a held quote later -> Quote held (HV-2015 shape)", () => {
    const f = job("ready_check_scheduled", { rcBookingAt: ago(1), measurementStartedAt: ago(1), quote: { releaseState: "held", holdReason: "review", sentAt: null, status: "draft", acceptedAt: null } });
    expect(officeStatus(f, NOW)?.key).toBe("quote.held");
  });
  test("onsite booking with measure-up started -> started onsite, not just Booked", () => {
    expect(officeStatus(job("ready_check_scheduled", { rcBookingAt: ago(1), measurementStartedAt: ago(1) }), NOW)?.key).toBe("ready_check.onsite_started");
  });
  test("real booking only -> Booked", () => {
    expect(officeStatus(job("ready_check_scheduled", { rcBookingAt: ago(-1) }), NOW)?.key).toBe("ready_check.booked");
  });
  test("no test-name heuristic: a job called Test is classified by facts like any other", () => {
    const a = officeStatus(job("ready_check_scheduled", { id: "Test", rcBookingAt: ago(-1) }), NOW)?.key;
    expect(a).toBe(officeStatus(job("ready_check_scheduled", { rcBookingAt: ago(-1) }), NOW)?.key);
  });
});

describe("pipeline count and drilldown use the same loader and filters", () => {
  test("both handlers call loadOffice and exclude qa_test unless asked, archived always", async () => {
    const fn = await Bun.file("src/lib/office.functions.ts").text();
    const pipe = fn.slice(fn.indexOf("export const getPipeline"), fn.indexOf("export const listByStatus"));
    const list = fn.slice(fn.indexOf("export const listByStatus"), fn.indexOf("export const getJobRightNow"));
    for (const h of [pipe, list]) expect(h).toContain('loadOffice(supabaseAdmin, { includeTest: data.includeTest ?? false })');
    const srv = await Bun.file("src/lib/office.server.ts").text();
    expect(srv).toContain('(opts.includeTest ? true : j["source"] !== "qa_test") && !j["qa_archived_at"]');
  });
});
