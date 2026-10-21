import { describe, expect, test } from "bun:test";
import { jobStatusLine, type StatusFacts } from "../src/lib/job-status.core";
import { JOB_STAGES } from "../src/lib/job-list-page.core";
const f = (p: Partial<StatusFacts>): StatusFacts => ({ stage: "ready_check_ready_to_schedule", stageSince: "2026-10-20T00:00:00Z", now: new Date("2026-10-21T00:00:00Z"), staff: false, bookings: [], quoteSentAt: null, quoteAcceptedAt: null, safetyPaidAt: null, ownerTimesChosenAt: null, rectQuoteSentAt: null, paidInFullAt: null, apApprovedAt: null, safetyPay: null as never, payout: null, ...p });
describe("Step 1 (21 Oct)", () => {
  test("not asked: no 'owner choosing' wording", () => expect(jobStatusLine(f({})).text).not.toContain("Owner choosing"));
  test("asked, no reply: owner choosing", () => expect(jobStatusLine(f({ rcTimesAskedAt: "2026-10-20T01:00:00Z" })).text).toContain("Owner choosing Ready Check times"));
  test("asked then replied: not owner choosing", () => expect(jobStatusLine(f({ rcTimesAskedAt: "2026-10-20T01:00:00Z", rcTimesGivenAt: "2026-10-20T02:00:00Z" })).text).not.toContain("Owner choosing"));
  test("filters include the three PIESA stages", () => { for (const s of ["piesa_scheduled", "piesa_complete", "electrical_variation_pending"]) expect(JOB_STAGES).toContain(s as never); });
});
